// triggers.js — demo controls: /trigger/critical, /reset, /state, /health.
// Also wires /api/prepare, /api/status, /api/run via the orchestrator.

import { ingestEvent } from './ingest.js';
import { getHealth, resetRun, getMode } from './health.js';
import { getStats, chEnabled } from './clickhouse.js';
import { pgEnabled } from './postgres.js';
import { clientCount } from './ws.js';
import { prepare, run, stop, getStatus } from './orchestrator.js';
import { mockLoopRunning } from './mock-loop.js';

// The active run id for demo controls. /api/run sets it; triggers reuse it.
let activeRun = process.env.RUN_ID || `run_${stamp()}_01`;

function stamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

export function setActiveRun(run_id) {
  activeRun = run_id;
}
export function getActiveRun() {
  return activeRun;
}

export function registerRoutes(app, { MOCK }) {
  const mode = () => (MOCK ? 'mock' : 'real');

  // --- demo lifecycle -------------------------------------------------------
  app.post('/api/prepare', async (req, res) => {
    const out = await prepare(req.body || {}, mode());
    res.status(out.ok ? 200 : 400).json(out);
  });

  app.get('/api/status', (_req, res) => {
    res.json({ ...getStatus(), mode: mode(), run_id: activeRun });
  });

  app.post('/api/run', async (req, res) => {
    if (req.body?.run_id) activeRun = req.body.run_id;
    const out = await run(activeRun, mode());
    res.status(out.ok ? 200 : 400).json({ ...out, run_id: activeRun });
  });

  app.post('/api/stop', (_req, res) => res.json(stop()));

  // --- the money shot -------------------------------------------------------
  // GET /trigger/critical — inject one detected critical ("caught in X ms").
  app.get('/trigger/critical', (_req, res) => {
    const enriched = ingestEvent({
      run_id: activeRun,
      event_type: 'weakness_found',
      agent_id: 'agent-3',
      agent_persona: 'injection',
      target_component: '/api/search',
      severity: 'critical',
      description: "SQLi: ' OR 1=1 -- attempted on /api/search",
      payload: "' OR 1=1 --",
      http_status: 500,
      evidence: 'blocked by sqli_signature',
      src_ip: '10.0.0.66',
      ts: new Date().toISOString(),
    });
    res.json({ ok: true, seq: enriched.seq, tower_health: enriched.tower_health });
  });

  // --- reset / state / health ----------------------------------------------
  app.get('/reset', (_req, res) => {
    const h = resetRun(activeRun, mode());
    res.json({ ok: true, run_id: activeRun, tower_health: h });
  });

  app.get('/state', async (_req, res) => {
    const stats = await getStats(activeRun).catch(() => null);
    res.json({
      run_id: activeRun,
      mode: getMode(activeRun) === 'real' ? 'real' : 'mock',
      tower_health: getHealth(activeRun),
      stats,
      ws_clients: clientCount(),
      mock_loop_running: mockLoopRunning(),
    });
  });

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      uptime_s: Math.round(process.uptime()),
      mode: mode(),
      clickhouse: chEnabled ? 'wired' : 'in-memory',
      postgres: pgEnabled ? 'wired' : 'off',
      ws_clients: clientCount(),
    });
  });
}
