// run.js — the main flow: inspect folder → connect → prepare → run → open → watch.

import { resolve as resolvePath } from 'node:path';
import open from 'open';
import pc from 'picocolors';
import { resolveConfig } from '../config.js';
import { makeApi } from '../api.js';
import { inspect } from '../inspect.js';
import { log } from '../render.js';
import { streamRun } from './watch.js';

export async function cmdRun(parsed) {
  const { flags } = parsed;
  const cfg = resolveConfig(flags);
  const api = makeApi(cfg.coordinator);

  const targetPath = resolvePath(parsed._[0] || process.cwd());
  const meta = inspect(targetPath);

  log.banner(meta.name, meta.files);
  if (meta.endpoints.length) {
    log.info(`detected endpoints: ${meta.endpoints.join(', ')}`);
  }

  // 1. connect — fail fast with a clear message
  try {
    const h = await api.health();
    log.ok(`connecting to coordinator… ${pc.dim(`(${cfg.coordinator})`)}`);
    if (cfg.mode && h.mode && cfg.mode !== h.mode) {
      log.info(`note: coordinator is in ${h.mode} mode; --${cfg.mode} is advisory`);
    }
  } catch (err) {
    log.err(err.offline ? 'coordinator not running. start the backend first:' : err.message);
    if (err.offline) console.error(`      ${pc.dim('cd backend && MOCK=true npm start')}`);
    process.exitCode = 1;
    return;
  }

  // 2. prepare
  await api.prepare({
    folder: meta.name,
    path: targetPath,
    files: meta.files,
    endpoints: meta.endpoints,
    mode: cfg.mode,
  });
  log.step('preparing sandbox…');

  // 3. wait for ready, rendering phases
  await pollStatus(api);
  log.ok('sandbox ready');

  // 4. run
  log.step('launching 6 agents…');
  const runRes = await api.run(flags.runId ? { run_id: flags.runId } : {});
  const runId = runRes.run_id;
  log.ok(`agents launched  ${pc.dim(`run_id: ${runId}`)}`);

  // 5. open dashboard
  const url = `${cfg.dashboard}/?run=${encodeURIComponent(runId)}`;
  if (flags.open === false) {
    log.info(`dashboard → ${url} ${pc.dim('(--no-open)')}`);
  } else {
    log.ok(`dashboard → ${url}  ${pc.dim('(opening…)')}`);
    open(url).catch(() => log.info('could not auto-open browser; copy the URL above'));
  }

  // 6. watch
  await streamRun({ wsUrl: cfg.wsUrl, runId });
}

async function pollStatus(api, { tries = 40, intervalMs = 200 } = {}) {
  let lastPhase = null;
  for (let i = 0; i < tries; i++) {
    let s;
    try {
      s = await api.status();
    } catch {
      s = null;
    }
    if (s?.phase && s.phase !== lastPhase) {
      lastPhase = s.phase;
      log.info(`phase: ${s.phase}`);
    }
    if (s?.ready) return s;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  log.info('coordinator did not report ready; continuing anyway');
}
