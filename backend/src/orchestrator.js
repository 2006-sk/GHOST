// orchestrator.js — /api/prepare + /api/run. Starts Guild sessions (real) or the
// mock loop (mock). Guild input schema is master.md §4.7 (Kenil owns it).

import { AGENTS } from './contract.js';
import { setMode } from './health.js';
import { startMockLoop, stopMockLoop } from './mock-loop.js';
import { recordRunStart, setAgentState as pgAgentState } from './postgres.js';

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

// Start one Guild session per agent. Confirm push-vs-pull with Kenil; built for
// PUSH (agents POST to /events via Guild's emit tool).
async function startGuildSessions(run_id) {
  if (!GUILD_API_KEY) {
    return { ok: false, error: 'GUILD_API_KEY not set' };
  }
  const emit_url = `${PUBLIC_URL}/events`;
  const started = [];
  for (const [agent_id, a] of Object.entries(AGENTS)) {
    const input = {
      run_id,
      mode: 'real',
      agent_persona: a.persona,
      target: { base_url: `${PUBLIC_URL}/`, tool: 'target_http' },
      emit_url,
      shared_memory_ref: `${run_id}/memory`,
      intensity: 'demo',
    };
    try {
      // Placeholder for Kenil's Guild session-start call. Kept as a logged hook
      // so real mode is wired the moment the Guild endpoint is confirmed.
      console.log(`[orchestrator] would start Guild session`, JSON.stringify(input));
      started.push(agent_id);
      pgAgentState(run_id, agent_id, 'attacking');
    } catch (err) {
      console.error(`[orchestrator] Guild start failed for ${agent_id}`, err.message);
    }
  }
  return { ok: true, mode: 'real', agents: started.length, source: 'guild', emit_url };
}
