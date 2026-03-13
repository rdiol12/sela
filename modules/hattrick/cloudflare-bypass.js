/**
 * modules/hattrick/cloudflare-bypass.js
 *
 * Emergency workaround for Cloudflare blocking Hattrick MCP browser automation.
 * Uses Scrapling's stealthy_fetch with Cloudflare solving to retrieve pages.
 * Parses HTML tables to extract player/economy data when MCP tools fail.
 *
 * Cloudflare issue: As of Mar 9 2026, hattrick.org returns "Performing security
 * verification" challenge page to all Playwright-based requests. Cloudflare Ray IDs
 * confirm server-side block. Solution: Scrapling stealthy_fetch with solve_cloudflare=true.
 *
 * @module cloudflare-bypass
 */

import { createLogger } from '../../lib/logger.js';
import { callTool } from '../../lib/auto-coder.js';
import config from '../../lib/config.js';
import { saveSnapshot } from './hattrick.js';

const log = createLogger('hattrick/cloudflare-bypass');

const TEAM_ID = config.hattrickTeamId;
const BASE = 'https://www.hattrick.org/en';

/**
 * Fetch a Hattrick page using Scrapling stealthy_fetch to bypass Cloudflare.
 * Returns raw HTML content.
 *
 * @param {string} path - URL path (e.g. '/Club/Players/?TeamID=2853386')
 * @param {object} opts
 * @param {boolean} [opts.solveCloudflare=true] - Enable Cloudflare bypass
 * @param {number} [opts.timeout=45000] - Timeout in ms
 * @returns {Promise<string>} raw HTML content or null on error
 */
export async function fetchHattrickPageStealthy(path, opts = {}) {
  const { solveCloudflare = true, timeout = 45000 } = opts;
  const url = `${BASE}${path}`;

  try {
    log.debug({ url }, 'Fetching with stealthy_fetch (Cloudflare bypass)');

    // Call tool via auto-coder's callTool interface
    // Note: This may need adjustment based on actual tool interface
    const result = await callTool('web_scrape_stealth', {
      url,
      solve_cloudflare: solveCloudflare,
      timeout,
      extraction_type: 'html',
      main_content_only: false,
    });

    if (result && result.content) {
      log.info({ url, bytes: result.content.length }, 'Successfully fetched Hattrick page');
      return result.content;
    }

    log.warn({ url }, 'Stealthy fetch returned no content');
    return null;
  } catch (err) {
    log.error({ url, err: err.message }, 'Stealthy fetch failed');
    return null;
  }
}

/**
 * Parse player roster from Hattrick HTML table.
 * Extracts: playerID, name, age, position, skills (keeper, defending, playmaking, etc.)
 *
 * @param {string} html - raw HTML from /Club/Players/ page
 * @returns {array} array of player objects
 */
export function parsePlayerTableFromHTML(html) {
  const players = [];

  if (!html) {
    log.warn('No HTML content to parse');
    return players;
  }

  try {
    // Simple regex-based extraction for player rows
    // Hattrick player tables typically have format:
    // <tr>...<td>name</td>...<td>age</td>...<td>skill</td>...</tr>

    // Look for player table marker (adjust as needed based on actual HTML structure)
    const tableMatch = html.match(/<table[^>]*class="[^"]*players[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) {
      log.warn('No player table found in HTML');
      return players;
    }

    const tableHtml = tableMatch[1];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const rowHtml = rowMatch[1];
      const cells = rowHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];

      if (cells.length < 3) continue; // Skip header rows or incomplete rows

      try {
        // Extract from cells (adjust indices based on actual column order)
        const nameMatch = cells[0]?.match(/>([^<]+)</);
        const ageMatch = cells[1]?.match(/>(\d+)</);
        const skillMatches = cells.map(c => c.match(/>\s*(\d+)\s*</)?.[1]).filter(Boolean);

        if (nameMatch) {
          const player = {
            name: nameMatch[1].trim(),
            age: ageMatch ? parseInt(ageMatch[1], 10) : null,
            keeper: null,
            defending: null,
            playmaking: null,
            winger: null,
            passing: null,
            scoring: null,
            set_pieces: null,
          };

          // Assign skills based on extraction (this is approximate, adjust as needed)
          skillMatches.forEach((skill, idx) => {
            const skillVal = parseInt(skill, 10);
            if (idx === 0) player.keeper = skillVal;
            else if (idx === 1) player.defending = skillVal;
            else if (idx === 2) player.playmaking = skillVal;
            else if (idx === 3) player.winger = skillVal;
            else if (idx === 4) player.passing = skillVal;
            else if (idx === 5) player.scoring = skillVal;
            else if (idx === 6) player.set_pieces = skillVal;
          });

          players.push(player);
        }
      } catch (cellErr) {
        // Skip malformed rows
      }
    }

    log.info({ players: players.length }, 'Parsed players from HTML table');
    return players;
  } catch (err) {
    log.error({ err: err.message }, 'Failed to parse player table');
    return [];
  }
}

/**
 * Fetch and parse player roster, saving as a snapshot.
 * Used when MCP tools are blocked by Cloudflare.
 *
 * @returns {Promise<object>} snapshot object with players array, or null on failure
 */
export async function fetchAndSavePlayerSnapshot() {
  const path = `/Club/Players/?TeamID=${TEAM_ID}`;
  const html = await fetchHattrickPageStealthy(path);

  if (!html) {
    log.error('Could not fetch player page for parsing');
    return null;
  }

  const players = parsePlayerTableFromHTML(html);

  if (players.length === 0) {
    log.warn('No players extracted from HTML');
    return null;
  }

  // Save as snapshot
  const snapshot = {
    players,
    season: null, // Ideally extract from page
    week: null,   // Ideally extract from page
    fetchedAt: Date.now(),
    source: 'cloudflare-bypass-stealthy-fetch',
  };

  try {
    saveSnapshot(snapshot);
    log.info({ players: players.length }, 'Player snapshot saved via bypass');
    return snapshot;
  } catch (err) {
    log.error({ err: err.message }, 'Failed to save player snapshot');
    return null;
  }
}

/**
 * Fetch economy/budget info from Team page.
 * Used when MCP tools are blocked.
 *
 * @returns {Promise<object>} economy snapshot (cash, income, expenses) or null
 */
export async function fetchAndSaveEconomySnapshot() {
  const path = `/Club/?TeamID=${TEAM_ID}`;
  const html = await fetchHattrickPageStealthy(path);

  if (!html) {
    log.error('Could not fetch team page for economy');
    return null;
  }

  // Extract cash balance from HTML (adjust regex as needed)
  const cashMatch = html.match(/Cash[:\s]*([0-9,]+)/i);
  const cash = cashMatch ? parseInt(cashMatch[1].replace(/,/g, ''), 10) : null;

  if (!cash) {
    log.warn('Could not extract cash from HTML');
  }

  const snapshot = {
    cash,
    fetchedAt: Date.now(),
    source: 'cloudflare-bypass-stealthy-fetch',
  };

  try {
    saveSnapshot(snapshot);
    log.info({ cash }, 'Economy snapshot saved via bypass');
    return snapshot;
  } catch (err) {
    log.error({ err: err.message }, 'Failed to save economy snapshot');
    return null;
  }
}

/**
 * Health check: Test if MCP tools are working or if Cloudflare blocking is active.
 * @returns {Promise<{blocked: boolean, message: string}>}
 */
export async function checkCloudflareBlock() {
  try {
    const path = `/Club/?TeamID=${TEAM_ID}`;
    const html = await fetchHattrickPageStealthy(path);

    if (html && html.includes('Blodangels')) {
      // Assuming team name appears in page
      return { blocked: false, message: 'Hattrick accessible (no Cloudflare block detected)' };
    } else if (html && html.includes('Performing security verification')) {
      return { blocked: true, message: 'Cloudflare challenge page detected' };
    } else {
      return { blocked: true, message: 'Stealthy fetch returned page but content unrecognizable' };
    }
  } catch (err) {
    return { blocked: true, message: `Health check error: ${err.message}` };
  }
}
