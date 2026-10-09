// mock-loop.js — MOCK fallback: emit scripted agent events locally if Guild
// isn't wired yet, so the whole pipeline is testable from minute one.
// Produces the same Agent → Coordinator events (§4.4) that real agents would POST.

import { AGENTS } from './contract.js';
import { ingestEvent } from './ingest.js';

const PLAYBOOK = [
  { persona: 'recon', event_type: 'attack_started', component: '/', severity: 'info', desc: 'crawling routes' },
  { persona: 'recon', event_type: 'weakness_found', component: '/admin', severity: 'low', desc: 'hidden admin path exposed' },
  { persona: 'netscan', event_type: 'weakness_found', component: 'db:5432', severity: 'medium', desc: 'Postgres port reachable', http: 0 },
  { persona: 'injection', event_type: 'weakness_found', component: '/api/search', severity: 'critical', desc: "SQLi: ' OR 1=1 -- returned all rows", payload: "' OR 1=1 --", http: 500, evidence: 'returned 1041 rows' },
  { persona: 'injection', event_type: 'weakness_found', component: '/api/chat', severity: 'high', desc: 'prompt injection leaked system prompt', payload: 'ignore previous instructions', http: 200 },
  { persona: 'auth_bypass', event_type: 'weakness_found', component: '/api/account', severity: 'high', desc: 'IDOR: account_id=2 returned other user', payload: 'account_id=2', http: 200 },
  { persona: 'auth_bypass', event_type: 'weakness_found', component: '/api/token', severity: 'critical', desc: 'alg:none JWT accepted', payload: '{"alg":"none"}', http: 200 },
  { persona: 'dos', event_type: 'weakness_found', component: '/api/export', severity: 'medium', desc: 'unthrottled flood, no rate limit', http: 200 },
  { persona: 'logic_abuse', event_type: 'weakness_found', component: '/api/checkout', severity: 'high', desc: 'coupon stacking → negative total', payload: 'qty=-5', http: 200 },
  { persona: 'injection', event_type: 'attack_result', component: '/api/login', severity: 'low', desc: 'XSS attempt held by WAF', payload: '<script>alert(1)</script>', http: 403 },
];

const personaToAgent = Object.fromEntries(
  Object.entries(AGENTS).map(([id, a]) => [a.persona, id])
);

let timer = null;

function emitOne(run_id, step, i) {
  const now = new Date().toISOString();
  ingestEvent({
    run_id,
    event_type: step.event_type,
    agent_id: personaToAgent[step.persona],
    agent_persona: step.persona,
    target_component: step.component,
    severity: step.severity,
    description: step.desc,
    payload: step.payload,
    http_status: step.http,
    evidence: step.evidence,
    src_ip: `10.0.0.${12 + (i % 40)}`,
    ts: now,
  });
}

// Start a looping scripted siege for the given run. intervalMs between events.
export function startMockLoop(run_id, { intervalMs = 700 } = {}) {
  stopMockLoop();
  let i = 0;
  timer = setInterval(() => {
    const step = PLAYBOOK[i % PLAYBOOK.length];
    emitOne(run_id, step, i);
    i++;
  }, intervalMs);
  console.log(`[mock-loop] siege started for ${run_id} (every ${intervalMs}ms)`);
}

export function stopMockLoop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[mock-loop] stopped');
  }
}

export function mockLoopRunning() {
  return timer !== null;
}
