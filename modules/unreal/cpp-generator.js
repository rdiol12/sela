/**
 * modules/unreal/cpp-generator.js — Generate UE5 C++ game system classes via Claude.
 *
 * Calls Claude to generate typed .h/.cpp pairs for core game systems, writes them
 * to ShatteredCrown/Source/ShatteredCrown/, then triggers UBT to compile.
 *
 * Why C++ over Blueprint nodes:
 *  - Blueprint node graphs require exact pin names/types — silent failures when wrong
 *  - C++ compiles with real error messages, types are validated at build time
 *  - Core systems (character, game mode, GAS) are best implemented in C++
 *
 * Supported system types: character, game_mode, player_controller, logic_interpreter,
 *                         gameplay_ability
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { createLogger } from '../../lib/logger.js';
import { chatOneShot } from '../../lib/claude.js';

const log = createLogger('cpp-generator');

// ── Paths ─────────────────────────────────────────────────────────────────────

const GAME_SOURCE = 'C:/Users/rdiol/sela/workspace/shattered-crown/ShatteredCrown/Source/ShatteredCrown';
const PUBLIC_DIR  = join(GAME_SOURCE, 'Public');
const PRIVATE_DIR = join(GAME_SOURCE, 'Private');

const UBT      = `"D:/Program Files/Epic Games/UE_5.7/Engine/Build/BatchFiles/Build.bat"`;
const UPROJECT = `"C:/Users/rdiol/sela/workspace/shattered-crown/ShatteredCrown/ShatteredCrown.uproject"`;

// ── JSON extractor ────────────────────────────────────────────────────────────

function extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  try { return JSON.parse(text.trim()); } catch { /* fall through */ }
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch { /* fall through */ }
  }
  return null;
}

// ── UBT compilation ───────────────────────────────────────────────────────────

/**
 * Run Unreal Build Tool on ShatteredCrown.
 * Returns { success: bool, errors: string[] }.
 * Takes up to 3 minutes — UBT compiles the full module.
 */
export function compileProject() {
  log.info('Compiling ShatteredCrown via UBT');
  try {
    const cmd = `${UBT} ShatteredCrownEditor Win64 Development ${UPROJECT} -WaitMutex`;
    const output = execSync(cmd, { timeout: 180_000, encoding: 'utf-8' });

    // Collect error lines
    const errors = output.split('\n')
      .filter(l => l.match(/\berror\s+C\d+|\berror:\s+|undefined\s+symbol|fatal\s+error/i))
      .map(l => l.trim());

    if (errors.length === 0) {
      log.info('UBT compile succeeded');
      return { success: true, errors: [] };
    }
    log.warn({ count: errors.length }, 'UBT compile finished with errors');
    return { success: false, errors };
  } catch (err) {
    const stderrErrors = (err.stderr || '')
      .split('\n')
      .filter(l => l.match(/\berror/i))
      .map(l => l.trim());
    log.error({ err: err.message }, 'UBT compilation failed');
    return { success: false, errors: stderrErrors.length ? stderrErrors : [err.message] };
  }
}

// ── File helpers ──────────────────────────────────────────────────────────────

/** Returns true if both .h and .cpp for the given filename already exist. */
export function cppFileExists(filename) {
  return existsSync(join(PUBLIC_DIR, `${filename}.h`))
      || existsSync(join(PRIVATE_DIR, `${filename}.cpp`));
}

function ensureDirs() {
  [PUBLIC_DIR, PRIVATE_DIR].forEach(d => {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  });
}

// ── Claude prompt ─────────────────────────────────────────────────────────────

const SYSTEM_DESCRIPTIONS = {
  character:          'AShatteredCrownCharacter extending ACharacter. Add UAbilitySystemComponent + UAttributeSet for GAS. Include UCameraComponent, USpringArmComponent, health/stamina attributes. BeginPlay: grant default abilities.',
  game_mode:          'AShatteredCrownGameMode extending AGameModeBase. Set default pawn class to AShatteredCrownCharacter. Override InitGame to seed RNG. Add a simple wave-spawner hook.',
  player_controller:  'AShatteredCrownPlayerController extending APlayerController. Add EnhancedInput setup (UEnhancedInputLocalPlayerSubsystem). Bind Move, Look, Jump, Dodge, PrimaryAttack InputActions. Forward to possessed pawn.',
  logic_interpreter:  'ULogicInterpreter extending UActorComponent. Data-driven ruleset executor — see existing LogicInterpreter.h in Public/ before generating.',
  gameplay_ability:   'USCGameplayAbility extending UGameplayAbility. Base class for all Shattered Crown abilities. Add: FGameplayTagContainer AbilityTags; bool CanActivateAbility override; CommitAbility helper; ActivateAbility → K2_EndAbility flow.',
};

function buildCppPrompt(systemType, extraContext = {}) {
  const desc = SYSTEM_DESCRIPTIONS[systemType] || `A UE5 ${systemType} class for The Shattered Crown.`;
  const contextStr = Object.keys(extraContext).length
    ? `\nAdditional context: ${JSON.stringify(extraContext)}`
    : '';

  return `Generate UE5 C++ for The Shattered Crown (dark fantasy action-RPG).

System to implement: ${systemType}
Description: ${desc}${contextStr}

Modules available in the project: Engine, CoreUObject, GameplayAbilities, GameplayTags,
  GameplayTasks, EnhancedInput, AIModule, NavigationSystem, Niagara, UMG, Json, JsonUtilities.

Rules:
- First line of .h: #include "CoreMinimal.h"
- Last include in .h: #include "FileName.generated.h"
- Module export macro: SHATTEREDCROWN_API
- Class prefix: A for actors, U for components/objects, F for structs
- Mark Blueprint-accessible members with UPROPERTY/UFUNCTION macros
- Keep .cpp #includes minimal — prefer forward declarations in .h
- Do NOT implement game logic in constructors; use BeginPlay / Initialize

Return ONLY valid JSON — no explanation, no markdown, no code fences:
{ "filename": "ExactClassName", "header": "complete .h content", "source": "complete .cpp content" }`;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate a C++ file pair for the given system type and write it to ShatteredCrown/Source.
 * Returns { success, filename } on success, or { success: false, error } on failure.
 * Skips silently if the file already exists.
 */
export async function generateCppFile(systemType, extraContext = {}) {
  log.info({ systemType }, 'Generating C++ file pair');

  const prompt = buildCppPrompt(systemType, extraContext);
  let parsed;

  try {
    const result = await chatOneShot(prompt, null);
    parsed = extractJson(result.reply);
    if (!parsed?.filename || !parsed?.header || !parsed?.source) {
      throw new Error(`Claude returned invalid C++ JSON (missing filename/header/source)`);
    }
  } catch (err) {
    log.error({ err: err.message, systemType }, 'Claude C++ generation failed');
    return { success: false, error: err.message };
  }

  const { filename, header, source } = parsed;
  log.info({ filename, systemType }, 'Claude generated C++ pair');

  if (cppFileExists(filename)) {
    log.info({ filename }, 'C++ file already exists — skipping write');
    return { success: true, skipped: true, filename };
  }

  ensureDirs();

  try {
    writeFileSync(join(PUBLIC_DIR, `${filename}.h`), header, 'utf-8');
    writeFileSync(join(PRIVATE_DIR, `${filename}.cpp`), source, 'utf-8');
    log.info({ filename }, 'C++ files written to ShatteredCrown/Source');
    return { success: true, filename };
  } catch (err) {
    log.error({ err: err.message, filename }, 'Failed to write C++ files');
    return { success: false, error: err.message };
  }
}
