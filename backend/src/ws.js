// ws.js — WebSocket connection mgmt, snapshot on connect, broadcast.
// Emits the 4 message kinds from master.md §4.5: snapshot, event, detection, stats.

import { WebSocketServer } from 'ws';
import { getHealth, getMode } from './health.js';
import { getStats } from './clickhouse.js';

let wss = null;

// ring buffer of the last ~50 enriched `event` messages, per run, for snapshots
const recent = new Map(); // run_id -> enriched[]
const RECENT_MAX = 50;
let lastRunId = null;

export function rememberEvent(enriched) {
  lastRunId = enriched.run_id;
  if (!recent.has(enriched.run_id)) recent.set(enriched.run_id, []);
  const arr = recent.get(enriched.run_id);
  arr.push(enriched);
  if (arr.length > RECENT_MAX) arr.shift();
}

export function attachWss(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws) => {
    try {
      ws.send(JSON.stringify(await buildSnapshot()));
    } catch (err) {
      console.error('[ws] snapshot error', err.message);
    }

    ws.on('error', (err) => console.error('[ws] client error', err.message));
  });

  console.log('[ws] WebSocket server mounted at /ws');
  return wss;
}

async function buildSnapshot() {
  const run_id = lastRunId || 'run_pending';
  const events = recent.get(run_id) || [];
  const stats = await getStats(run_id).catch(() => null);
  return {
    kind: 'snapshot',
    run_id,
    mode: getMode(run_id) === 'real' ? 'real' : 'mock',
    tower_health: getHealth(run_id),
    events,
    stats: stats || {
      coverage_pct: 0,
      mttd_ms: 0,
      total_events: 0,
      detected: 0,
      missed: 0,
    },
  };
}

// Broadcast an already-serialisable message object to every open client.
export function broadcast(msg) {
  if (!wss) return;
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) {
      try {
        client.send(data);
      } catch (err) {
        console.error('[ws] send error', err.message);
      }
    }
  }
}

export function clientCount() {
  return wss ? wss.clients.size : 0;
}
