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

// Aditya's stats.sql (data/clickhouse/stats.sql) — returns coverage/mttd AND the
// by_persona / by_severity breakdowns straight from ClickHouse as nested JSON.
// Inner aliases (det/mttd) differ from column names on purpose: aliasing
// countIf(detected) AS detected shadows the column and breaks avgIf(..., detected).
const STATS_SQL = `
SELECT
  t.total_events                                            AS total_events,
  t.det                                                     AS detected,
  t.total_events - t.det                                    AS missed,
  if(t.total_events = 0, 0, round(100 * t.det / t.total_events, 1)) AS coverage_pct,
  round(ifNotFinite(t.mttd, 0), 1)                          AS mttd_ms,
  p.m                                                       AS by_persona,
  s.m                                                       AS by_severity
FROM
( SELECT count() AS total_events, countIf(detected) AS det, avgIf(detect_latency_ms, detected) AS mttd
  FROM ${CH_DB}.events WHERE run_id = {run:String} ) AS t
CROSS JOIN
( SELECT mapFromArrays(groupArray(agent_persona), groupArray(map('events', n, 'detected', d))) AS m
  FROM ( SELECT agent_persona, count() AS n, countIf(detected) AS d
         FROM ${CH_DB}.events WHERE run_id = {run:String} GROUP BY agent_persona ) ) AS p
CROSS JOIN
( SELECT mapFromArrays(groupArray(severity), groupArray(n)) AS m
  FROM ( SELECT severity, count() AS n
         FROM ${CH_DB}.events WHERE run_id = {run:String} AND severity != '' GROUP BY severity ) ) AS s
FORMAT JSONEachRow
SETTINGS output_format_json_quote_64bit_integers = 0`;

async function statsFromClickHouse(run_id) {
  try {
    const url = new URL(CH_URL);
    url.searchParams.set('param_run', run_id);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Authorization: 'Basic ' + Buffer.from(`${CH_USER}:${CH_PASSWORD}`).toString('base64'),
      },
      body: STATS_SQL,
    });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    if (!text) return null;
    const row = JSON.parse(text.split('\n')[0]); // JSONEachRow → one object per line
    return {
      kind: 'stats',
      run_id,
      coverage_pct: Number(row.coverage_pct) || 0,
      mttd_ms: Number(row.mttd_ms) || 0,
      total_events: Number(row.total_events) || 0,
      detected: Number(row.detected) || 0,
      missed: Number(row.missed) || 0,
      by_persona: row.by_persona || {},   // { persona: { events, detected } } — from ClickHouse
      by_severity: row.by_severity || {}, // { severity: count } — from ClickHouse
    };
  } catch (err) {
    console.error('[clickhouse] stats error', err.message);
    return null;
  }
}

export async function shutdownClickHouse() {
  await flush();
}
