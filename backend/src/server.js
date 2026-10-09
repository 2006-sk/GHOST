// server.js — express + ws bootstrap. The one service everything plugs into.

import http from 'node:http';
import express from 'express';
import { handleEvents } from './ingest.js';
import { registerRoutes, getActiveRun } from './triggers.js';
import { attachWss, broadcast } from './ws.js';
import { getStats, shutdownClickHouse } from './clickhouse.js';
import { shutdownPostgres } from './postgres.js';

const PORT = Number(process.env.COORDINATOR_PORT || 8080);
const MOCK = process.env.MOCK !== 'false'; // default mock-safe

const app = express();
app.use(express.json({ limit: '1mb' }));

// CORS — the frontend dev server (Vite :5173) talks to us cross-origin.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// §4.4 Agent → Coordinator ingest.
app.post('/events', handleEvents);

// §4.6 demo controls + triggers + state/health.
registerRoutes(app, { MOCK });

const server = http.createServer(app);
attachWss(server);

// stats pump — push a `stats` message ~every 1s straight from ClickHouse/tally.
const statsTimer = setInterval(async () => {
  try {
    const stats = await getStats(getActiveRun());
    if (stats) broadcast(stats);
  } catch (err) {
    console.error('[stats] pump error', err.message);
  }
}, 1000);

server.listen(PORT, () => {
  console.log('='.repeat(56));
  console.log(`  GHOST Coordinator`);
  console.log(`  mode:       ${MOCK ? 'MOCK (demo-safe)' : 'REAL (live attacks)'}`);
  console.log(`  http:       http://localhost:${PORT}`);
  console.log(`  ws:         ws://localhost:${PORT}/ws`);
  console.log(`  ingest:     POST http://localhost:${PORT}/events`);
  console.log(`  run siege:  POST http://localhost:${PORT}/api/run`);
  console.log(`  money shot: GET  http://localhost:${PORT}/trigger/critical`);
  console.log('='.repeat(56));
});

async function shutdown(sig) {
  console.log(`\n[server] ${sig} — shutting down`);
  clearInterval(statsTimer);
  await shutdownClickHouse().catch(() => {});
  await shutdownPostgres().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
