// ingest.js — the core path. POST /events: validate, enrich, persist, broadcast.
// Implements the exact enrichment logic from shresth.md.

import { validateEvent } from './contract.js';
import { nextSeq, applyHealth, getMode } from './health.js';
import { detect, detectMock } from './detect.js';
import { insertEvent } from './clickhouse.js';
import { broadcast, rememberEvent } from './ws.js';

// Process one validated agent event end to end.
// Returns the enriched event (also broadcast + persisted as a side effect).
export function ingestEvent(event) {
  const run_id = event.run_id;
  const mode = getMode(run_id);
  const seq = nextSeq(run_id);

  // Detection verdict. In mock it's final inline; in real it's provisional now
  // and corrected when ClickHouse answers (see correctVerdict below).
  const verdict = detect(event, seq, mode);

  const { health_delta, tower_health } = applyHealth(run_id, event, verdict.detected);

  const enriched = {
    kind: 'event',
    run_id,
    seq,
    event_type: event.event_type,
    agent_id: event.agent_id,
    agent_persona: event.agent_persona,
    target_component: event.target_component ?? null,
    severity: event.severity ?? null,
    description: event.description ?? null,
    health_delta,
    tower_health,
    ts: event.ts,
  };

  // Visual lane — broadcast NOW, never wait on the database.
  rememberEvent(enriched);
  broadcast(enriched);

  // Persist the full scored row (enriched + verdict fields).
  insertEvent({
    run_id,
    seq,
    event_type: event.event_type,
    agent_id: event.agent_id,
    agent_persona: event.agent_persona,
    target_component: event.target_component ?? null,
    severity: event.severity ?? null,
    description: event.description ?? null,
    payload: event.payload ?? null,
    http_status: event.http_status ?? null,
    evidence: event.evidence ?? null,
    src_ip: event.src_ip ?? null,
    health_delta,
    tower_health,
    detected: verdict.detected,
    rule: verdict.rule,
    detect_latency_ms: verdict.latency_ms,
    confidence: verdict.confidence,
    ts: event.ts,
  });

  // Analytics lane — detection message, matched to the event by seq.
  if (mode === 'real') {
    // Correct the provisional verdict asynchronously once CH scores it.
    correctVerdict(run_id, seq, event);
  } else {
    broadcast({
      kind: 'detection',
      run_id,
      seq,
      detected: verdict.detected,
      rule: verdict.rule,
      latency_ms: verdict.latency_ms,
      confidence: verdict.confidence,
    });
  }

  return enriched;
}

// In real mode the ClickHouse verdict may lag. For the hackathon we reuse the
// same rule engine as a stand-in scorer so the demo still produces a real
// `detection` message; swap this for a ClickHouse read when Aditya's verdict
// SQL is wired. tower_health is corrected if the verdict flips.
function correctVerdict(run_id, seq, event) {
  setTimeout(() => {
    const verdict = detectMock(event, seq);
    // If it turns out detected, heal back any provisional damage we applied.
    const { tower_health } = applyHealth(run_id, event, verdict.detected);
    broadcast({
      kind: 'detection',
      run_id,
      seq,
      detected: verdict.detected,
      rule: verdict.rule,
      latency_ms: verdict.latency_ms,
      confidence: verdict.confidence,
    });
    if (verdict.detected) {
      // shield held after all — re-broadcast corrected health so UI heals
      broadcast({ kind: 'event', run_id, seq, corrected: true, tower_health, ts: event.ts });
    }
  }, 30);
}

// Express handler for POST /events.
export function handleEvents(req, res) {
  const event = req.body;
  const v = validateEvent(event);
  if (!v.ok) {
    console.warn('[ingest] rejected event:', v.error);
    return res.status(400).json({ ok: false, error: v.error });
  }
  try {
    const enriched = ingestEvent(event);
    return res.status(202).json({ ok: true, seq: enriched.seq, tower_health: enriched.tower_health });
  } catch (err) {
    console.error('[ingest] error', err.message);
    return res.status(500).json({ ok: false, error: 'ingest failed' });
  }
}
