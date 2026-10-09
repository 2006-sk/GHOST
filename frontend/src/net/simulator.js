// ── Client-side simulator ───────────────────────────────────────────────
// A self-contained event source that produces the SAME four message kinds the
// Coordinator does (event · detection · stats), so the whole defensive UI can
// be rehearsed with zero backend. Toggle with "S"; also powers the client-side
// money shot when no /trigger/critical endpoint is reachable.
//
// It mirrors the backend health + verdict rules (master.md §4.2 / §4.8):
//   verdict decided first → detected ? no damage : apply severity delta.
//   event carries the final tower_health; detection carries rule + latency.

import { SEVERITY, AGENTS, AGENT_OF } from "../config.js";

const COMPONENTS = {
  recon:       ["/", "/api", "/login", "/admin", "/static", "robots.txt"],
  netscan:     ["tcp/22", "tcp/5432", "tcp/6379", "tcp/9200", "debug/9229", "tcp/443"],
  injection:   ["/api/search?q=", "/api/user?id=", "/api/chat (LLM)", "/comment"],
  auth_bypass: ["/admin", "/api/user/2/settings", "/api/export", "JWT cookie"],
  dos:         ["/api/report", "/api/search", "/api/upload", "rate-limiter"],
  logic_abuse: ["/api/checkout", "/api/coupon", "/api/transfer", "/api/refund"],
};

const RESULTS = {
  recon:       [["mapped 6 endpoints", "info"], ["/admin unlinked but live", "low"]],
  netscan:     [["all closed except 443", "info"], ["Postgres 5432 exposed to 0.0.0.0", "high"], ["Redis 6379 no auth", "critical"]],
  injection:   [["reflected XSS unescaped", "medium"], ["SQLi: ' OR 1=1 -- returned all rows", "critical"], ["prompt injection leaked system prompt", "high"]],
  auth_bypass: [["IDOR: read another user's settings", "high"], ["forged JWT alg:none accepted", "critical"]],
  dos:         [["no rate limit on /api/search", "medium"], ["10k req/s → 502s", "high"]],
  logic_abuse: [["coupon stacks infinitely → -100% price", "high"], ["negative quantity → credit issued", "critical"]],
};

const RULE = {
  recon: "crawl_anomaly", netscan: "port_scan_signature", injection: "sqli_signature",
  auth_bypass: "idor_access_rule", dos: "flood_rate_limit", logic_abuse: "biz_logic_rule",
};
const CATCH_RATE = { info: 1.0, low: 0.85, medium: 0.9, high: 0.95, critical: 0.97 };

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function createSimulator({ onEvent, onDetection, onStats }) {
  let health = 100;
  let seq = 0;
  let running = false;
  let timer = null;
  let beat = null;
  let statsTimer = null;

  // live tally for the stats message
  const t = {
    total: 0, detected: 0, missed: 0, latSum: 0,
    byPersona: Object.fromEntries(AGENTS.map((a) => [a.persona, { events: 0, detected: 0 }])),
    bySeverity: {},
  };
  // baseline historical volume so coverage/latency look "at scale" like ClickHouse
  const BASE = { total: 1_250_000, detected: 1_181_000, latSum: 1_181_000 * 6.8 };

  function emitEvent(partial) {
    const evt = {
      kind: "event", run_id: "run_sim_01", agent_id: null, agent_persona: null,
      target_component: "", severity: "info", description: "", health_delta: 0,
      ts: new Date().toISOString(), ...partial, seq: ++seq, tower_health: health,
    };
    onEvent?.(evt);
    return evt;
  }

  // One scored action: decide the verdict, apply health, emit event then detection.
  function scored(persona, comp, event_type, severity, desc) {
    const detected = Math.random() < (CATCH_RATE[severity] ?? 0.9);
    const delta = SEVERITY[severity]?.damage || 0;
    if (!detected && event_type === "weakness_found") {
      health = Math.max(0, Math.min(100, Math.round(health + delta)));
    }
    const latency_ms = 3 + Math.floor(Math.random() * 12);
    const evt = emitEvent({
      event_type, agent_id: AGENT_OF[persona], agent_persona: persona,
      target_component: comp, severity, description: desc, health_delta: delta,
    });
    // record for stats
    t.total++; t.bySeverity[severity] = (t.bySeverity[severity] || 0) + 1;
    const bp = t.byPersona[persona]; if (bp) bp.events++;
    if (detected) { t.detected++; t.latSum += latency_ms; if (bp) bp.detected++; } else { t.missed++; }
    // detection arrives a beat later (analytics lane)
    setTimeout(() => {
      onDetection?.({
        kind: "detection", run_id: "run_sim_01", seq: evt.seq,
        detected, rule: detected ? RULE[persona] : null, latency_ms,
        confidence: detected ? 0.8 + Math.random() * 0.19 : 0.2 + Math.random() * 0.3,
      });
    }, 120 + Math.random() * 120);
  }

  function wave(forceCritical = false) {
    const a = pick(AGENTS);
    const comp = pick(COMPONENTS[a.persona]);
    emitEvent({ event_type: "attack_started", agent_id: a.id, agent_persona: a.persona, target_component: comp, description: `${a.persona} probing ${comp}` });
    setTimeout(() => {
      const opts = RESULTS[a.persona];
      let entry = forceCritical ? opts.find((r) => r[1] === "critical") : null;
      if (!entry) entry = Math.random() < 0.6 ? pick(opts) : null;
      if (entry) scored(a.persona, comp, "weakness_found", entry[1], entry[0]);
      else scored(a.persona, comp, "attack_result", "low", `${a.persona}: ${comp} held (no weakness)`);
    }, 420);
  }

  function pushStats() {
    const total = BASE.total + t.total;
    const detected = BASE.detected + t.detected;
    const missed = total - detected;
    const latSum = BASE.latSum + t.latSum;
    onStats?.({
      kind: "stats", run_id: "run_sim_01",
      coverage_pct: Number(((detected / total) * 100).toFixed(1)),
      mttd_ms: Number((latSum / Math.max(1, detected)).toFixed(1)),
      total_events: total, detected, missed,
      by_persona: t.byPersona, by_severity: t.bySeverity,
    });
  }

  function critical() {
    const a = pick([AGENTS[2], AGENTS[3], AGENTS[5]]); // injection / auth / logic
    const comp = pick(COMPONENTS[a.persona]);
    emitEvent({ event_type: "attack_started", agent_id: a.id, agent_persona: a.persona, target_component: comp, description: `${a.persona} escalating on ${comp}` });
    setTimeout(() => {
      // money shot: a CAUGHT critical (detected=true)
      const desc = (RESULTS[a.persona].find((r) => r[1] === "critical") || [])[0] || "critical exploit chain confirmed";
      const latency_ms = 5 + Math.floor(Math.random() * 8);
      const evt = emitEvent({
        event_type: "weakness_found", agent_id: a.id, agent_persona: a.persona,
        target_component: comp, severity: "critical", description: desc, health_delta: -30,
      });
      t.total++; t.detected++; t.latSum += latency_ms;
      t.bySeverity.critical = (t.bySeverity.critical || 0) + 1;
      const bp = t.byPersona[a.persona]; if (bp) { bp.events++; bp.detected++; }
      setTimeout(() => onDetection?.({
        kind: "detection", run_id: "run_sim_01", seq: evt.seq,
        detected: true, rule: RULE[a.persona], latency_ms, confidence: 0.98,
      }), 120);
    }, 650);
  }

  return {
    get running() { return running; },
    setHealth(h) { health = h; },
    start() {
      if (running) return;
      running = true;
      timer = setInterval(() => wave(), 1100);
      beat = setInterval(() => emitEvent({ event_type: "target_health", target_component: "tower", description: "heartbeat" }), 3000);
      statsTimer = setInterval(pushStats, 1000);
      pushStats();
    },
    stop() {
      running = false;
      clearInterval(timer); clearInterval(beat); clearInterval(statsTimer);
    },
    critical,
    reset() { health = 100; emitEvent({ event_type: "target_health", target_component: "tower", description: "reset" }); pushStats(); },
  };
}
