// clickhouse.js — INSERT (batched) + stats queries over the HTTP interface.
// Degrades gracefully: if CLICKHOUSE_URL is unset we keep an in-memory tally so
// MOCK mode runs fully standalone and `stats` still reflects what we've ingested.

import { PERSONAS } from './contract.js';

const CH_URL = process.env.CLICKHOUSE_URL || '';
const CH_USER = process.env.CLICKHOUSE_USER || 'default';
const CH_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';
const CH_DB = process.env.CLICKHOUSE_DATABASE || 'ghost';

export const chEnabled = Boolean(CH_URL);

// ---- in-memory fallback tally (per run) --------------------------------------
const tally = new Map(); // run_id -> { total, detected, missed, latSum, byPersona, bySeverity }

function bucket(run_id) {
  if (!tally.has(run_id)) {
    tally.set(run_id, {
      total: 0,
      detected: 0,
      missed: 0,
      latSum: 0,
      byPersona: Object.fromEntries(PERSONAS.map((p) => [p, { events: 0, detected: 0 }])),
      bySeverity: {},
    });
  }
  return tally.get(run_id);
}

function record(row) {
  const b = bucket(row.run_id);
  b.total += 1;
  if (row.detected) {
    b.detected += 1;
    b.latSum += row.detect_latency_ms || 0;
  } else {
    b.missed += 1;
  }
  const p = b.byPersona[row.agent_persona];
  if (p) {
    p.events += 1;
    if (row.detected) p.detected += 1;
  }
  if (row.severity) {
    b.bySeverity[row.severity] = (b.bySeverity[row.severity] || 0) + 1;
  }
}

// ---- batched insert ----------------------------------------------------------
let buffer = [];
let flushTimer = null;
const BATCH_MAX = 500;
const BATCH_MS = 200;

async function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer.length === 0) return;
  const rows = buffer;
  buffer = [];

  if (!chEnabled) return; // tally already updated at enqueue time

  const body =
    `INSERT INTO ${CH_DB}.events FORMAT JSONEachRow\n` +
    rows.map((r) => JSON.stringify(r)).join('\n');

  try {
    const res = await fetch(CH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Authorization: 'Basic ' + Buffer.from(`${CH_USER}:${CH_PASSWORD}`).toString('base64'),
      },
      body,
    });
    if (!res.ok) {
      console.error('[clickhouse] insert failed', res.status, (await res.text()).slice(0, 300));
    }
  } catch (err) {
    console.error('[clickhouse] insert error', err.message);
  }
}

// Enqueue an enriched+scored row for insertion. Always updates the local tally
// so stats work whether or not ClickHouse is wired.
export function insertEvent(row) {
  record(row);
  buffer.push(row);
  if (buffer.length >= BATCH_MAX) {
    flush();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flush, BATCH_MS);
  }
}

// ---- stats -------------------------------------------------------------------
// Build the §4.5 `stats` message. Uses ClickHouse (Aditya's stats.sql) when
// available, else the in-memory tally.
export async function getStats(run_id) {
  if (chEnabled) {
    const fromCH = await statsFromClickHouse(run_id);
    if (fromCH) return fromCH;
  }
  return statsFromTally(run_id);
}

function statsFromTally(run_id) {
  const b = bucket(run_id);
  const coverage_pct = b.total ? Number(((b.detected / b.total) * 100).toFixed(1)) : 0;
  const mttd_ms = b.detected ? Number((b.latSum / b.detected).toFixed(1)) : 0;
  return {
    kind: 'stats',
    run_id,
    coverage_pct,
    mttd_ms,
    total_events: b.total,
    detected: b.detected,
    missed: b.missed,
    by_persona: b.byPersona,
    by_severity: b.bySeverity,
  };
}

async function statsFromClickHouse(run_id) {
  // Aditya owns the exact stats.sql; this is the HTTP shape we expect.
  // NOTE: do not alias a column with countIf(detected) AS detected — the alias
  // shadows the `detected` column and breaks avgIf(..., detected). Use distinct
  // alias names and reference the column directly inside the If-aggregates.
  const sql = `
    SELECT
      count() AS total_events,
      countIf(detected) AS detected_n,
      countIf(NOT detected) AS missed,
      round(100 * countIf(detected) / count(), 1) AS coverage_pct,
      round(avgIf(detect_latency_ms, detected), 1) AS mttd_ms
    FROM ${CH_DB}.events
    WHERE run_id = {run:String}
    FORMAT JSON`;
  try {
    const url = new URL(CH_URL);
    url.searchParams.set('param_run', run_id);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Authorization: 'Basic ' + Buffer.from(`${CH_USER}:${CH_PASSWORD}`).toString('base64'),
      },
      body: sql,
    });
    if (!res.ok) return null;
    const json = await res.json();
    const row = json.data?.[0];
    if (!row) return null;
    // merge persona/severity breakdowns from the local tally (cheap, already live)
    const local = statsFromTally(run_id);
    return {
      kind: 'stats',
      run_id,
      coverage_pct: Number(row.coverage_pct) || 0,
      mttd_ms: Number(row.mttd_ms) || 0,
      total_events: Number(row.total_events) || 0,
      detected: Number(row.detected_n) || 0,
      missed: Number(row.missed) || 0,
      by_persona: local.by_persona,
      by_severity: local.by_severity,
    };
  } catch (err) {
    console.error('[clickhouse] stats error', err.message);
    return null;
  }
}

export async function shutdownClickHouse() {
  await flush();
}
