// triggers.js — demo controls: /trigger/critical, /reset, /state, /health.
// Also wires /api/prepare, /api/status, /api/run via the orchestrator.

import { ingestEvent } from './ingest.js';
import { getHealth, resetRun, getMode } from './health.js';
import { getStats, chEnabled } from './clickhouse.js';
import { pgEnabled, pgMode, listRuns, listAgentsForRun, recordRunEnd } from './postgres.js';
import { clientCount } from './ws.js';
import { prepare, run, stop, getStatus, guildStatus, startDemo } from './orchestrator.js';
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

  // Demo mode (cached): paced ~30s replay of the real-LLM siege + SEMGREP.
  app.post('/api/demo', (req, res) => {
    activeRun = (req.body && req.body.run_id) || `run_demo_${stamp()}_${Math.floor(Math.random() * 1000)}`;
    const durationMs = (req.body && Number(req.body.durationMs)) || 30000;
    const out = startDemo(activeRun, { durationMs, target: req.body && req.body.target });
    res.json({ ...out, run_id: activeRun });
  });

  app.post('/api/stop', async (_req, res) => {
    const out = stop();
    const stats = await getStats(activeRun).catch(() => null);
    recordRunEnd(activeRun, stats?.coverage_pct); // persist run end + final coverage
    res.json(out);
  });

  // Guild control-plane status: authenticated? which ghost personas deployed?
  app.get('/api/guild/status', async (_req, res) => {
    try { res.json(await guildStatus()); }
    catch (err) { res.status(500).json({ authenticated: false, error: err.message }); }
  });

  // Postgres mutable state (runs + per-agent state) — proves it's not a no-op.
  app.get('/api/runs', async (_req, res) => {
    const runs = await listRuns(20).catch(() => []);
    res.json({ postgres: pgMode, runs });
  });
  app.get('/api/runs/:id/agents', async (req, res) => {
    res.json({ run_id: req.params.id, agents: await listAgentsForRun(req.params.id).catch(() => []) });
  });

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
      postgres: pgMode, // 'embedded' (PGlite) or 'remote'
      ws_clients: clientCount(),
    });
  });
}
