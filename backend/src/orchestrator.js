// orchestrator.js — /api/prepare + /api/run. Starts Guild sessions (real) or the
// mock loop (mock). Guild input schema is master.md §4.7 (Kenil owns it).

import { AGENTS } from './contract.js';
import { setMode } from './health.js';
import { startMockLoop, stopMockLoop } from './mock-loop.js';
import { recordRunStart, setAgentState as pgAgentState } from './postgres.js';
import { startGhostSessions, guildStatus } from './guild.js';

const GUILD_API_KEY = process.env.GUILD_API_KEY || '';
const GUILD_WORKSPACE = process.env.GUILD_WORKSPACE || '';
const PUBLIC_URL = process.env.PUBLIC_URL || '';

// phase is surfaced by GET /api/status
let phase = 'idle'; // idle -> preparing -> ready -> running
let ready = false;

export function getStatus() {
  return { phase, ready };
}

// POST /api/prepare — boot/confirm the target sandbox.
// mock: just report ready after a beat. real: confirm tunnel + register target.
export async function prepare({ folder } = {}, mode) {
  phase = 'preparing';
  ready = false;
  if (mode === 'real') {
    if (!PUBLIC_URL) {
      phase = 'error';
      return { ok: false, error: 'PUBLIC_URL (tunnel) required in real mode' };
    }
    // Real mode: Kenil/Aditya boot the TowerBank sandbox and expose it; we just
    // record the target here. Left as a hook — register as Guild target_http.
    console.log(`[orchestrator] real prepare for folder=${folder} target=${PUBLIC_URL}`);
  } else {
    console.log(`[orchestrator] mock prepare for folder=${folder || 'TowerBank'}`);
  }
  await new Promise((r) => setTimeout(r, 300));
  phase = 'ready';
  ready = true;
  return { ok: true, phase, ready };
}

// POST /api/run — start the siege.
// mock: start the scripted mock loop. real: start 6 Guild sessions (§4.7).
export async function run(run_id, mode) {
  setMode(run_id, mode);
  await recordRunStart(run_id, mode);
  phase = 'running';

  if (mode === 'real') {
    return startGuildSessions(run_id);
  }
  startMockLoop(run_id);
  for (const id of Object.keys(AGENTS)) {
    pgAgentState(run_id, id, 'attacking');
  }
  return { ok: true, mode, agents: Object.keys(AGENTS).length, source: 'mock-loop' };
}

export function stop() {
  stopMockLoop();
  phase = 'ready';
  return { ok: true };
}

// Expose the live Guild status (auth + which ghost personas are deployed).
export { guildStatus };

// Start one real Guild session per persona via the Guild API (guild.js). Built
// for PUSH (agents emit to /events). If the ghost personas aren't deployed to
// the workspace yet, this returns a clear error and the caller falls back to the
// mock loop so the siege still runs.
async function startGuildSessions(run_id) {
  const emit_url = `${PUBLIC_URL}/events`;
  const input = {
    run_id,
    mode: 'real',
    target: { base_url: `${PUBLIC_URL}/`, tool: 'target_http' },
    emit_url,
    shared_memory_ref: `${run_id}/memory`,
    intensity: 'demo',
  };
  try {
    const result = await startGhostSessions(input);
    if (result.ok) {
      for (const s of result.started) pgAgentState(run_id, `agent-${GHOST_IDX[s.persona] || ''}`, 'attacking');
      return { ok: true, mode: 'real', agents: result.count, source: 'guild', sessions: result.started, emit_url };
    }
    // Guild reachable but not ready (e.g. agents not deployed) → mock fallback.
    console.warn('[orchestrator] Guild not ready:', result.error);
    startMockLoop(run_id);
    return { ok: true, mode: 'real', source: 'mock-loop (guild fallback)', guild: result.guild, note: result.error, emit_url };
  } catch (err) {
    console.error('[orchestrator] Guild start error:', err.message);
    startMockLoop(run_id);
    return { ok: true, mode: 'real', source: 'mock-loop (guild error)', error: err.message, emit_url };
  }
}

const GHOST_IDX = { recon: 1, netscan: 2, injection: 3, auth_bypass: 4, dos: 5, logic_abuse: 6 };
