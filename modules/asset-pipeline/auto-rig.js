/**
 * modules/asset-pipeline/auto-rig.js — Auto-rigging via UniRig
 *
 * Wraps the UniRig Python pipeline to auto-rig GLB/FBX meshes.
 * Produces rigged FBX with skeleton + skin weights.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const UNIRIG_DIR = path.join(process.cwd(), 'workspace', 'UniRig');
const UNIRIG_PYTHON = path.join(UNIRIG_DIR, 'venv', 'Scripts', 'python.exe');
const RIG_SCRIPT = path.join(UNIRIG_DIR, 'rig_mesh.py');

/**
 * Check if UniRig is installed and ready.
 */
export function isUniRigReady() {
  return fs.existsSync(UNIRIG_PYTHON) && fs.existsSync(RIG_SCRIPT);
}

/**
 * Auto-rig a mesh file using UniRig.
 * @param {string} inputPath - Path to GLB/FBX/OBJ mesh
 * @param {string} outputPath - Path for rigged FBX output
 * @param {object} opts - Options: { seed, timeoutMs }
 * @returns {Promise<{success, output?, fileSize?, timings?, totalSeconds?, error?}>}
 */
export function rigMesh(inputPath, outputPath, opts = {}) {
  const { seed = 12345, timeoutMs = 600_000 } = opts;

  return new Promise((resolve) => {
    if (!isUniRigReady()) {
      return resolve({ success: false, error: 'UniRig not installed' });
    }

    const args = [
      RIG_SCRIPT,
      '--input', path.resolve(inputPath),
      '--output', path.resolve(outputPath),
      '--seed', String(seed),
      '--json',
    ];

    let stdout = '';
    let stderr = '';
    const startTime = Date.now();

    const proc = spawn(UNIRIG_PYTHON, args, {
      cwd: UNIRIG_DIR,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({ success: false, error: `Timeout after ${timeoutMs / 1000}s` });
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (code !== 0) {
        const lastLines = stderr.split('\n').slice(-10).join('\n');
        return resolve({
          success: false,
          error: `UniRig exited with code ${code}`,
          stderr: lastLines,
          elapsedSeconds: parseFloat(elapsed),
        });
      }

      // Parse JSON output (last line)
      try {
        const lines = stdout.trim().split('\n');
        const jsonLine = lines[lines.length - 1];
        const result = JSON.parse(jsonLine);
        return resolve(result);
      } catch (e) {
        // If JSON parse fails, check if file exists
        if (fs.existsSync(outputPath)) {
          return resolve({
            success: true,
            output: outputPath,
            fileSize: fs.statSync(outputPath).size,
            totalSeconds: parseFloat(elapsed),
          });
        }
        return resolve({
          success: false,
          error: `Failed to parse UniRig output: ${e.message}`,
          stdout: stdout.slice(-500),
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, error: `Spawn error: ${err.message}` });
    });
  });
}

/**
 * Auto-rig a mesh and import the rigged result into Blender.
 * @param {string} inputGlb - Path to the source GLB
 * @param {function} callTool - The MCP tool caller (for blender-mcp)
 * @param {object} opts - Options passed to rigMesh
 * @returns {Promise<{success, bones?, vertexGroups?, error?}>}
 */
export async function rigAndImport(inputGlb, callTool, opts = {}) {
  const basename = path.basename(inputGlb, path.extname(inputGlb));
  const outputFbx = path.join(UNIRIG_DIR, 'results', `${basename}_rigged.fbx`);

  const rigResult = await rigMesh(inputGlb, outputFbx, opts);
  if (!rigResult.success) return rigResult;

  // Import into Blender via MCP
  const importCode = `
import bpy
bpy.ops.import_scene.fbx(filepath='${outputFbx.replace(/\\/g, '/')}')
imported = [obj for obj in bpy.context.selected_objects]
info = {}
for obj in imported:
    if obj.type == 'ARMATURE':
        info['bones'] = len(obj.data.bones)
        info['boneNames'] = [b.name for b in obj.data.bones]
    elif obj.type == 'MESH':
        info['vertices'] = len(obj.data.vertices)
        info['faces'] = len(obj.data.polygons)
        info['vertexGroups'] = len(obj.vertex_groups)
print(str(info))
`;

  try {
    const blenderResult = await callTool('blender-mcp', 'execute_blender_code', { code: importCode });
    return {
      success: true,
      rigFile: outputFbx,
      ...rigResult,
      blenderImport: blenderResult,
    };
  } catch (e) {
    return {
      success: true,
      rigFile: outputFbx,
      ...rigResult,
      blenderImportError: e.message,
    };
  }
}
