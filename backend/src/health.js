// health.js — seq (monotonic per run) + tower_health + severity→delta.
// Coordinator owns all three; agents never send them.

import { SEVERITY, SCORED_TYPES, MAX_HEALTH, clampHealth } from './contract.js';

// Per-run runtime state kept in memory. Postgres is the durable copy (stretch).
const runs = new Map(); // run_id -> { seq, tower_health, mode }

function ensureRun(run_id, mode = 'mock') {
  if (!runs.has(run_id)) {
    runs.set(run_id, { seq: 0, tower_health: MAX_HEALTH, mode });
  }
  return runs.get(run_id);
}

export function nextSeq(run_id) {
  const r = ensureRun(run_id);
  return ++r.seq;
}

export function getHealth(run_id) {
  return ensureRun(run_id).tower_health;
}

export function resetRun(run_id, mode) {
  const r = ensureRun(run_id, mode);
  r.tower_health = MAX_HEALTH;
  // seq intentionally NOT reset — it stays monotonic for the life of the process
  // so the frontend never sees a seq go backwards within a session.
  return r.tower_health;
}

export function setMode(run_id, mode) {
  ensureRun(run_id, mode).mode = mode;
}

export function getMode(run_id) {
  return ensureRun(run_id).mode;
}

// severity → health_delta (only meaningful on scored events).
export function deltaFor(event) {
  if (!SCORED_TYPES.has(event.event_type)) return 0;
  const s = SEVERITY[event.severity];
  return s ? s.damage : 0;
}

// Apply the §4.8 health rule. Returns { health_delta, tower_health }.
// Detected attack → no damage (shield held). Missed → apply delta, clamped.
export function applyHealth(run_id, event, detected) {
  const r = ensureRun(run_id);
  const health_delta = deltaFor(event);

  if (SCORED_TYPES.has(event.event_type) && !detected) {
    r.tower_health = clampHealth(r.tower_health + health_delta);
  }
  return { health_delta, tower_health: r.tower_health };
}
