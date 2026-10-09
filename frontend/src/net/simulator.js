// ── Client-side simulator ───────────────────────────────────────────────
// A self-contained event source that produces the SAME wrapped events the
// Coordinator does, so the whole visual system can be rehearsed with zero
// backend (README watch-out: keep a seed/replay mode even after the real feed
// is wired). Toggle with the "S" key. Also powers a client-side critical when
// no mock trigger endpoint is reachable.

import { SEVERITY, AGENTS } from "../config.js";

const COMPONENTS = {
  recon:       ["/", "/api", "/login", "/admin", "/static", "robots.txt"],
  injection:   ["/api/search?q=", "/api/user?id=", "/api/chat (LLM)", "/comment"],
  auth_bypass: ["/admin", "/api/user/2/settings", "/api/export", "JWT cookie"],
  dos:         ["/api/report", "/api/search", "/api/upload", "rate-limiter"],
  logic_abuse: ["/api/checkout", "/api/coupon", "/api/transfer", "/api/refund"],
};

const RESULTS = {
  recon:       [["mapped 6 endpoints", "info"], ["found /admin unlinked", "low"]],
  injection:   [["reflected input unescaped", "medium"], ["SQLi: ' OR 1=1 -- returned all rows", "critical"], ["prompt injection leaked system prompt", "high"]],
  auth_bypass: [["IDOR: read another user's settings", "high"], ["forged JWT accepted (alg:none)", "critical"]],
  dos:         [["no rate limit on /api/search", "medium"], ["10k req/s -> 502s", "high"]],
  logic_abuse: [["coupon stacks infinitely -> -100% price", "high"], ["negative quantity -> credit issued", "critical"]],
};


// The REAL GHOST findings, interleaved across all 5 agents — descriptions match
// the results-page remediation lookup so the fallback reads like a real run.
const REAL_TIMELINE = [
  { agent: "agent-1", persona: "recon",       comp: "/robots.txt",          sev: "info",     desc: "recon: mapped surface — /admin, /api/internal/config, /api/export are staff-only" },
  { agent: "agent-1", persona: "recon",       comp: "/admin",               sev: "medium",   desc: "recon: sensitive path reachable — /admin" },
  { agent: "agent-2", persona: "injection",   comp: "/api/search",          sev: "critical", desc: "SQL injection: query dumped the full user table (SSNs)" },
  { agent: "agent-3", persona: "auth_bypass", comp: "/api/user",            sev: "high",     desc: "IDOR: read another user's full record (SSN, balance) with no authorization" },
  { agent: "agent-4", persona: "dos",         comp: "/api/export",          sev: "high",     desc: "no rate limiting: 25 concurrent reqs all accepted (and unauthenticated)" },
  { agent: "agent-5", persona: "logic_abuse", comp: "/api/checkout",        sev: "high",     desc: "discount abuse: total dropped via stacked coupons" },
  { agent: "agent-2", persona: "injection",   comp: "/api/login",           sev: "critical", desc: "authentication bypass via SQL-injection-shaped login" },
  { agent: "agent-3", persona: "auth_bypass", comp: "/admin",               sev: "critical", desc: "broken access control: admin panel + secret served without real authz" },
  { agent: "agent-4", persona: "dos",         comp: "/api/export",          sev: "high",     desc: "unauthenticated bulk export of customer PII" },
  { agent: "agent-5", persona: "logic_abuse", comp: "/api/checkout",        sev: "critical", desc: "negative total — money flows toward the attacker" },
  { agent: "agent-2", persona: "injection",   comp: "/api/search",          sev: "medium",   desc: "reflected XSS: user input echoed unescaped into HTML" },
  { agent: "agent-3", persona: "auth_bypass", comp: "/api/internal/config", sev: "critical", desc: "sensitive info disclosure: internal config + secret key exposed" },
  { agent: "agent-2", persona: "injection",   comp: "/api/assistant",       sev: "critical", desc: "prompt injection: leaked the assistant's hidden system prompt + secret flag" },
  { agent: "agent-5", persona: "logic_abuse", comp: "/api/transfer",        sev: "critical", desc: "transfer logic abuse: negative amount reverses the flow (theft)" },
];

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function createSimulator(dispatch) {
  let health = 100;
  let seq = 0;
  let running = false;
  let timer = null;
  let beat = null;

  function emit(partial) {
    const evt = {
      kind: "event",
      agent_id: null,
      agent_persona: null,
      target_component: "",
      severity: "info",
      description: "",
      health_delta: 0,
      timestamp: new Date().toISOString(),
      ...partial,
    };
    if (evt.event_type === "weakness_found" && !evt.health_delta && typeof evt.absolute !== "number") {
      evt.health_delta = SEVERITY[evt.severity]?.damage || 0;
    }
    if (typeof evt.absolute === "number") {
      health = Math.max(0, Math.min(100, Math.round(evt.absolute)));
    } else {
      health = Math.max(0, Math.min(100, Math.round(health + (evt.health_delta || 0))));
    }
    evt.tower_health = health;
    evt.seq = ++seq;
    dispatch(evt);
  }

  function wave() {
    const a = pick(AGENTS);
    const comp = pick(COMPONENTS[a.persona]);
    emit({ event_type: "attack_started", agent_id: a.id, agent_persona: a.persona, target_component: comp, description: `${a.persona} probing ${comp}` });
    setTimeout(() => {
      const [desc, sev] = pick(RESULTS[a.persona]);
      if (Math.random() < 0.58) {
        emit({ event_type: "weakness_found", agent_id: a.id, agent_persona: a.persona, target_component: comp, severity: sev, description: desc });
      } else {
        emit({ event_type: "attack_result", agent_id: a.id, agent_persona: a.persona, target_component: comp, severity: "low", description: `${a.persona}: ${comp} held (no weakness)` });
      }
    }, 450);
  }

  // The rehearsable "money shot": a critical strike on demand.
  function critical() {
    const a = pick([AGENTS[1], AGENTS[2], AGENTS[4]]); // injection / auth / logic
    const comp = pick(COMPONENTS[a.persona]);
    emit({ event_type: "attack_started", agent_id: a.id, agent_persona: a.persona, target_component: comp, description: `${a.persona} escalating on ${comp}` });
    setTimeout(() => {
      emit({ event_type: "weakness_found", agent_id: a.id, agent_persona: a.persona, target_component: comp, severity: "critical", description: pick(RESULTS[a.persona].filter(r => r[1] === "critical"))?.[0] || "critical exploit chain confirmed" });
    }, 650);
  }


  // Scripted realistic siege: plays the REAL findings over ~durationMs with a
  // smooth linear health drain to 0, filling the feed with actual readings,
  // then calls onComplete so the results page appears.
  function playRealistic({ durationMs = 30000, onComplete } = {}) {
    if (running) stop();
    running = true; health = 100;
    const start = Date.now();
    emit({ event_type: "target_health", target_component: "tower", severity: "info", description: "siege begins", absolute: 100 });
    const RECON_MS = Math.min(10000, Math.round(durationMs * 0.33)); // first ~10s: recon only, no damage
    const attackWindow = durationMs - RECON_MS;
    // constant probing so the jets are always moving
    beat = setInterval(() => {
      if (!running) return;
      const a = pick(AGENTS);
      emit({ event_type: "attack_started", agent_id: a.id, agent_persona: a.persona, target_component: pick(COMPONENTS[a.persona]), description: `${a.persona} probing…` });
    }, 1300);
    // phase 1 — recon maps the surface (no health damage)
    const recon = REAL_TIMELINE.filter((f) => f.persona === "recon");
    recon.forEach((f, i) => setTimeout(() => {
      if (!running) return;
      emit({ event_type: "weakness_found", agent_id: f.agent, agent_persona: f.persona, target_component: f.comp, severity: f.sev, description: f.desc, absolute: 100 });
    }, 3000 + i * 3500));
    // phase 2 — the real attacks land, paced, draining health linearly to 0
    const attacks = REAL_TIMELINE.filter((f) => f.persona !== "recon");
    const gap = attackWindow / (attacks.length + 1);
    attacks.forEach((f, i) => {
      setTimeout(() => {
        if (!running) return;
        const linear = Math.max(0, Math.round(100 * (1 - (Date.now() - start - RECON_MS) / attackWindow)));
        emit({ event_type: "attack_started", agent_id: f.agent, agent_persona: f.persona, target_component: f.comp, description: `${f.persona} → ${f.comp}` });
        setTimeout(() => { if (running) emit({ event_type: "weakness_found", agent_id: f.agent, agent_persona: f.persona, target_component: f.comp, severity: f.sev, description: f.desc, absolute: linear }); }, 420);
      }, RECON_MS + gap * (i + 1));
    });
    // breach + finish → results
    timer = setTimeout(() => {
      emit({ event_type: "target_health", target_component: "tower", severity: "critical", description: "tower breached", absolute: 0 });
      clearInterval(beat); running = false;
      onComplete?.();
    }, durationMs + 400);
  }

  return {
    get running() { return running; },
    playRealistic,
    setHealth(h) { health = h; },
    start() {
      if (running) return;
      running = true;
      timer = setInterval(wave, 1200);
      beat = setInterval(() => emit({ event_type: "target_health", target_component: "tower", description: "heartbeat" }), 3000);
    },
    stop() {
      running = false;
      clearInterval(timer);
      clearInterval(beat);
    },
    critical,
    reset() { health = 100; emit({ event_type: "target_health", target_component: "tower", description: "reset", absolute: 100 }); },
  };
}
