// status.js — one-shot: print current coverage/health/events, then exit.

import pc from 'picocolors';
import { resolveConfig } from '../config.js';
import { makeApi } from '../api.js';
import { statsFooter, log } from '../render.js';

export async function cmdStatus(parsed) {
  const { flags } = parsed;
  const cfg = resolveConfig(flags);
  const api = makeApi(cfg.coordinator);

  let state;
  try {
    state = await api.state();
  } catch (err) {
    log.err(err.offline ? 'coordinator not running.' : err.message);
    process.exitCode = 1;
    return;
  }

  const health = state.tower_health ?? '-';
  const healthColor = health >= 70 ? pc.green : health >= 30 ? pc.yellow : pc.red;
  console.log(`  ${pc.bold('GHOST')} ${pc.dim(state.run_id || '')}  mode: ${state.mode}`);
  console.log(`  tower_health: ${healthColor(health)}   ws_clients: ${state.ws_clients ?? 0}` +
    `   ${state.mock_loop_running ? pc.cyan('siege running') : pc.dim('idle')}`);
  if (state.stats) console.log(statsFooter(state.stats));
}
