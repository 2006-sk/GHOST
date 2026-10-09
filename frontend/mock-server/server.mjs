// ── Mock Coordinator ────────────────────────────────────────────────────
// A self-contained stand-in for GHOST's real Coordinator (backend/src). It
// speaks the EXACT wire format the frontend consumes (master.md §4.5), so
// `npm run dev` drives the full defensive UI with no backend, and switching
// mock → real is just "run the other server on :8080".
//
//   WS  ws://localhost:8080/ws
//     on connect →  { kind:"snapshot", run_id, mode:"mock", tower_health, events:[…], stats }
//     per action →  { kind:"event", … seq, health_delta, tower_health }
//                   { kind:"detection", seq, detected, rule, latency_ms, confidence }
//     ~1/s       →  { kind:"stats", coverage_pct, mttd_ms, total_events, detected, missed, by_* }
//
//   HTTP  GET /trigger/critical · GET /reset · GET /state · GET /health
//         POST /api/prepare · GET /api/status · POST /api/run · POST /api/stop · POST /events
//
// Only dependency: ws.   Run:  node mock-server/server.mjs   (or npm run mock)

import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 8080);
const RUN_ID = process.env.RUN_ID || "run_mock_01";

const SEVERITY_DAMAGE = { info: 0, low: -3, medium: -8, high: -15, critical: -30 };
const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const CATCH_RATE = { info: 1.0, low: 0.85, medium: 0.9, high: 0.95, critical: 0.97 };
const clamp = (h) => Math.max(0, Math.min(100, Math.round(h)));

// §4.1 roster (6 agents)
const AGENT_OF = {
  recon: "agent-1", netscan: "agent-2", injection: "agent-3",
  auth_bypass: "agent-4", dos: "agent-5", logic_abuse: "agent-6",
};
const PERSONAS = Object.keys(AGENT_OF);
const RULE = {
  recon: "crawl_anomaly", netscan: "port_scan_signature", injection: "sqli_signature",
  auth_bypass: "idor_access_rule", dos: "flood_rate_limit", logic_abuse: "biz_logic_rule",
};
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
  dos:         [["no rate limit on /api/search", "medium"], ["10k req/s -> 502s", "high"]],
  logic_abuse: [["coupon stacks infinitely -> -100% price", "high"], ["negative quantity -> credit issued", "critical"]],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ── state ──
let health = 100;
let seq = 0;
const recent = []; // last ~50 enriched events
const tallyBase = { total: 1_250_000, detected: 1_181_000, latSum: 1_181_000 * 6.8 };
const tally = {
  total: 0, detected: 0, missed: 0, latSum: 0,
  byPersona: Object.fromEntries(PERSONAS.map((p) => [p, { events: 0, detected: 0 }])),
  bySeverity: {},
};

const http = createServer();
const wss = new WebSocketServer({ server: http, path: "/ws" });

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of wss.clients) if (ws.readyState === 1) { try { ws.send(msg); } catch {} }
}

function statsMsg() {
  const total = tallyBase.total + tally.total;
  const detected = tallyBase.detected + tally.detected;
  const latSum = tallyBase.latSum + tally.latSum;
  return {
    kind: "stats", run_id: RUN_ID,
    coverage_pct: Number(((detected / total) * 100).toFixed(1)),
    mttd_ms: Number((latSum / Math.max(1, detected)).toFixed(1)),
    total_events: total, detected, missed: total - detected,
    by_persona: tally.byPersona, by_severity: tally.bySeverity,
  };
}

// Emit one agent action through the full two-lane pipeline.
function emit({ event_type, persona, target_component = "", severity = "info", description = "", forceDetected = null }) {
  const agent_id = AGENT_OF[persona] || null;
  seq += 1;

  const scored = event_type === "weakness_found" || event_type === "attack_result";
  const detected = scored
    ? (forceDetected != null ? forceDetected : Math.random() < (CATCH_RATE[severity] ?? 0.9))
    : false;
  const health_delta = scored ? (SEVERITY_DAMAGE[severity] || 0) : 0;
  if (event_type === "weakness_found" && !detected) health = clamp(health + health_delta);

  const enriched = {
    kind: "event", run_id: RUN_ID, seq, event_type, agent_id, agent_persona: persona,
    target_component: String(target_component), severity: scored ? severity : null,
    description: String(description), health_delta, tower_health: health,
    ts: new Date().toISOString(),
  };
  recent.push(enriched);
  if (recent.length > 50) recent.shift();
  broadcast(enriched);

  if (scored) {
    const latency_ms = 3 + Math.floor(Math.random() * 12);
    tally.total++; tally.bySeverity[severity] = (tally.bySeverity[severity] || 0) + 1;
    const bp = tally.byPersona[persona]; if (bp) bp.events++;
    if (detected) { tally.detected++; tally.latSum += latency_ms; if (bp) bp.detected++; } else tally.missed++;
    setTimeout(() => broadcast({
      kind: "detection", run_id: RUN_ID, seq,
      detected, rule: detected ? RULE[persona] : null, latency_ms,
      confidence: detected ? 0.8 + Math.random() * 0.19 : 0.2 + Math.random() * 0.3,
    }), 60 + Math.random() * 100);
  }
  return enriched;
}

// ── choreography ──
function wave(forceSeverity = null) {
  const persona = pick(PERSONAS);
  const comp = pick(COMPONENTS[persona]);
  emit({ event_type: "attack_started", persona, target_component: comp, description: `${persona} probing ${comp}` });
  setTimeout(() => {
    const opts = RESULTS[persona];
    let entry = forceSeverity ? opts.find((r) => r[1] === forceSeverity) : null;
    if (!entry) entry = pick(opts.filter((r) => r[1] !== "critical")) || pick(opts);
    const [desc, sev] = entry;
    const hit = forceSeverity ? true : Math.random() < 0.55;
    if (hit) emit({ event_type: "weakness_found", persona, target_component: comp, severity: sev, description: desc });
    else emit({ event_type: "attack_result", persona, target_component: comp, severity: "low", description: `${persona}: ${comp} held (no weakness)` });
  }, 400 + Math.random() * 300);
}

// money shot: a CAUGHT critical
function criticalStrike() {
  const persona = pick(["injection", "auth_bypass", "logic_abuse"]);
  const comp = pick(COMPONENTS[persona]);
  emit({ event_type: "attack_started", persona, target_component: comp, description: `${persona} escalating on ${comp}` });
  setTimeout(() => {
    const desc = (RESULTS[persona].find((r) => r[1] === "critical") || [])[0] || "critical exploit chain confirmed";
    emit({ event_type: "weakness_found", persona, target_component: comp, severity: "critical", description: desc, forceDetected: true });
  }, 600);
}

// ── auto loop ──
let paused = false, loopTimer = null, beatTimer = null, statsTimer = null, waveCount = 0;
function startLoop() {
  stopLoop();
  loopTimer = setInterval(() => {
    if (paused) return;
    const escalate = waveCount % 9 === 8 && health > 45;
    wave(escalate ? pick(["high", "critical"]) : null);
    waveCount++;
    if (health <= 0) {
      paused = true;
      setTimeout(() => { health = 100; broadcast({ kind: "event", run_id: RUN_ID, seq: ++seq, event_type: "target_health", agent_id: null, agent_persona: null, tower_health: 100, health_delta: 0, ts: new Date().toISOString() }); paused = false; }, 4500);
    }
  }, 1400);
  beatTimer = setInterval(() => { if (!paused) emit({ event_type: "target_health", persona: null, target_component: "tower", description: "heartbeat" }); }, 3000);
  statsTimer = setInterval(() => broadcast(statsMsg()), 1000);
}
function stopLoop() { clearInterval(loopTimer); clearInterval(beatTimer); clearInterval(statsTimer); }

// ── HTTP ──
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };
http.on("request", async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const json = (code, body) => { res.writeHead(code, { "content-type": "application/json", ...CORS }); res.end(JSON.stringify(body)); };
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }

  switch (url.pathname) {
    case "/health": return json(200, { ok: true, mode: "mock", tower_health: health, events: recent.length, ws_clients: wss.clients.size });
    case "/state": return json(200, { run_id: RUN_ID, mode: "mock", tower_health: health, stats: statsMsg(), ws_clients: wss.clients.size });
    case "/api/status": return json(200, { phase: "running", ready: true, mode: "mock", run_id: RUN_ID });
    case "/api/prepare":
      if (req.method !== "POST") return json(405, { error: "POST only" });
      return json(200, { ok: true, phase: "ready", ready: true, mode: "mock" });
    case "/api/run":
      if (req.method !== "POST") return json(405, { error: "POST only" });
      paused = false; return json(200, { ok: true, mode: "mock", run_id: RUN_ID, agents: PERSONAS.length });
    case "/api/stop":
      if (req.method !== "POST") return json(405, { error: "POST only" });
      paused = true; return json(200, { ok: true });
    case "/trigger/critical": criticalStrike(); return json(200, { ok: true, fired: "critical" });
    case "/reset": health = 100; broadcast({ kind: "event", run_id: RUN_ID, seq: ++seq, event_type: "target_health", agent_id: null, agent_persona: null, tower_health: 100, health_delta: 0, ts: new Date().toISOString() }); return json(200, { ok: true, tower_health: health });
    case "/pause": paused = true; return json(200, { ok: true, paused });
    case "/resume": paused = false; return json(200, { ok: true, paused });
    case "/events": {
      if (req.method !== "POST") return json(405, { error: "POST only" });
      const evt = await readBody(req);
      if (!evt || !evt.agent_persona) return json(400, { ok: false, error: "invalid event" });
      const e = emit({ event_type: evt.event_type, persona: evt.agent_persona, target_component: evt.target_component, severity: evt.severity, description: evt.description });
      return json(202, { ok: true, seq: e.seq, tower_health: e.tower_health });
    }
    default:
      return json(404, { error: "not found", routes: ["/health", "/state", "/api/status", "POST /api/prepare", "POST /api/run", "POST /api/stop", "/trigger/critical", "/reset", "POST /events", "ws:///ws"] });
  }
});

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ kind: "snapshot", run_id: RUN_ID, mode: "mock", tower_health: health, events: recent.slice(-50), stats: statsMsg() }));
});

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve(null); } });
    req.on("error", () => resolve(null));
  });
}

http.listen(PORT, () => {
  startLoop();
  console.log(`\n  ┌─ MOCK COORDINATOR (GHOST contract) ───────────────────────`);
  console.log(`  │  ws + http on  :${PORT}`);
  console.log(`  │  frontend →    ws://localhost:${PORT}/ws   (snapshot/event/detection/stats)`);
  console.log(`  │  money shot →  http://localhost:${PORT}/trigger/critical`);
  console.log(`  │  reset →       http://localhost:${PORT}/reset`);
  console.log(`  │  6 agents · auto loop running (pause: /pause  resume: /resume)`);
  console.log(`  └────────────────────────────────────────────────────────────\n`);
});

process.on("SIGINT", () => { stopLoop(); wss.close(); http.close(() => process.exit(0)); });
