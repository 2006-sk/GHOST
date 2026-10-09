// detect.js — detection verdict.
// MOCK: cheap inline rules (stand-in for Aditya's verdict helper) so each `event`
//       already carries a final tower_health.
// REAL: ClickHouse computes the verdict and it may lag; we apply provisional
//       damage and correct on the verdict (handled in ingest.js).

// Rough per-persona detection signatures. Each returns a rule name when it fires.
const RULES = {
  injection: (e) => matchInjection(e),
  auth_bypass: (e) => matchAuth(e),
  dos: (e) => 'flood_rate_limit',
  netscan: (e) => 'port_scan_signature',
  recon: (e) => 'crawl_anomaly',
  logic_abuse: (e) => 'biz_logic_rule',
  semgrep: (e) => e.rule || 'sast_rule', // static findings carry their own rule id
};

function matchInjection(e) {
  const p = (e.payload || e.description || '').toLowerCase();
  if (/(\bor\b\s+1=1|union\s+select|--|;--|')/.test(p)) return 'sqli_signature';
  if (/<script|onerror=|javascript:/.test(p)) return 'xss_signature';
  if (/ignore (previous|above)|system prompt|jailbreak/.test(p)) return 'prompt_injection_rule';
  return 'injection_heuristic';
}

function matchAuth(e) {
  const p = (e.payload || e.description || '').toLowerCase();
  if (/alg.*none|"none"/.test(p)) return 'jwt_alg_none';
  if (/idor|user_id=|account_id=/.test(p)) return 'idor_access_rule';
  return 'auth_anomaly';
}

// Deterministic-ish coverage so the demo coverage % is believable but repeatable.
// Higher-severity attacks are more likely to be caught (shield prioritises them).
const CATCH_RATE = { info: 1.0, low: 0.85, medium: 0.9, high: 0.95, critical: 0.97 };

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff; // 0..1
}

// Inline mock verdict. Deterministic per (run_id, seq) so replays are stable.
export function detectMock(event, seq) {
  const persona = event.agent_persona;
  const rule = (RULES[persona] || (() => 'generic_rule'))(event);
  const rate = CATCH_RATE[event.severity] ?? 0.9;
  const roll = hashString(`${event.run_id}:${seq}:${persona}`);
  const detected = roll < rate;
  const latency_ms = 3 + Math.floor(hashString(`lat:${event.run_id}:${seq}`) * 12); // 3–14ms
  const confidence = detected ? 0.8 + roll * 0.19 : 0.2 + roll * 0.3;
  return {
    detected,
    rule: detected ? rule : null,
    latency_ms,
    confidence: Number(confidence.toFixed(2)),
  };
}

// Real-mode verdict comes from ClickHouse (clickhouse.js). Until it arrives we
// return a provisional "not yet scored" verdict; ingest corrects on the real one.
export function detectProvisional() {
  return { detected: false, rule: null, latency_ms: 0, confidence: 0, provisional: true };
}

export function detect(event, seq, mode) {
  return mode === 'real' ? detectProvisional() : detectMock(event, seq);
}
