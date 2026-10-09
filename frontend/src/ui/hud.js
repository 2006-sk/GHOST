// ── HUD ─────────────────────────────────────────────────────────────────
// Defensive command center. Monochrome base with two restrained accents:
//   cool  = INTERCEPTED / shield held   warm = MISSED / damage got through.
// Accents never carry meaning alone — every verdict also shows a ✓ / ✗ glyph
// and a text label, so the HUD still reads with color vision differences.
//
// Fed by the Coordinator's four message kinds:
//   event      → a detection-feed row appears (pending), roster goes ATTACKING
//   detection  → that row resolves to ✓ BLOCKED (rule · Xms) or ✗ MISSED
//   stats      → COVERAGE % + DETECTION LATENCY tiles + DETECTED vs MISSED chart

import { AGENTS, SEVERITY, PERSONA_LABEL } from "../config.js";

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const el = {
    conn: $("conn"), connText: $("conn-text"),
    health: $("health-num"), healthFill: $("health-fill"),
    coverage: $("coverage-num"), latency: $("latency-num"),
    seq: $("seq-num"),
    target: $("target-name"), run: $("run-id"),
    rosterList: $("roster-list"),
    bannerList: $("banner-list"),
    bannerLabel: $("banner-label"),
    chartHealth: $("chart-health"), chartBreak: $("chart-breakdown"),
    hud: $("hud"),
  };

  // ── roster rows ──
  const rows = {};
  const blockedByAgent = {};
  for (const a of AGENTS) {
    blockedByAgent[a.id] = 0;
    const li = document.createElement("li");
    li.className = "agent-row";
    li.innerHTML = `
      <div class="a-name"><span>${a.label}</span><span class="a-count" data-count>·0</span></div>
      <div class="a-state" data-state>IDLE</div>
      <div class="a-target" data-target>${a.tag}</div>`;
    el.rosterList.appendChild(li);
    rows[a.id] = li;
  }

  const healthHistory = [100];
  // seq → feed row element (so a detection can resolve its pending row)
  const feedRows = new Map();
  // live detected/missed tally — a fallback until `stats` messages arrive
  let tally = { detected: 0, missed: 0 };
  let stats = null; // last `stats` message (authoritative when present)

  // ── connection / mode badge ──
  function setConnection(status) {
    const map = {
      connecting: ["conn-down", "CONNECTING"],
      defending:  ["conn-live", "● DEFENDING"],
      live:       ["conn-live", "● DEFENDING · LIVE"],
      mock:       ["conn-live", "● DEFENDING · MOCK"],
      sim:        ["conn-live", "● SIM / REHEARSAL"],
      down:       ["conn-down", "RECONNECTING…"],
    };
    const [cls, text] = map[status] || map.down;
    el.conn.className = "conn " + cls;
    el.connText.textContent = text;
  }

  function setTarget(name) { el.target.textContent = name; }
  function setRun(id) { if (el.run) el.run.textContent = id || "—"; }

  function setHealth(h) {
    h = Math.max(0, Math.min(100, Math.round(h)));
    el.health.textContent = h;
    el.healthFill.style.width = h + "%";
    el.healthFill.classList.toggle("low", h < 35);
    healthHistory.push(h);
    if (healthHistory.length > 160) healthHistory.shift();
  }

  function seedHealth(values) {
    if (!values?.length) return;
    healthHistory.length = 0;
    for (const v of values) healthHistory.push(Math.max(0, Math.min(100, Math.round(v))));
  }

  function setSeq(n) { if (typeof n === "number") el.seq.textContent = n; }

  // COVERAGE % + DETECTION LATENCY + DETECTED/MISSED chart, straight from ClickHouse.
  function setStats(msg) {
    if (!msg) return;
    stats = msg;
    if (typeof msg.coverage_pct === "number") el.coverage.textContent = msg.coverage_pct.toFixed(1);
    if (typeof msg.mttd_ms === "number") el.latency.textContent = msg.mttd_ms.toFixed(1);
  }

  // ── roster ──
  function updateAgent(id, stateLabel, target) {
    const li = rows[id];
    if (!li) return;
    const stateEl = li.querySelector("[data-state]");
    stateEl.textContent = stateLabel;
    stateEl.dataset.k = stateLabel.toLowerCase();
    if (target) li.querySelector("[data-target]").textContent = target;
    li.classList.toggle("active", stateLabel !== "IDLE");
    if (stateLabel === "BLOCKED") {
      blockedByAgent[id] = (blockedByAgent[id] || 0) + 1;
      const c = li.querySelector("[data-count]");
      if (c) c.textContent = "·" + blockedByAgent[id];
    }
  }

  // ── detection feed ──
  // A weakness_found arrives → create a pending row. Its matching detection
  // resolves it to BLOCKED or MISSED (matched by seq).
  function pushDetectionPending(evt) {
    const sev = SEVERITY[evt.severity] || SEVERITY.info;
    const li = document.createElement("li");
    li.className = `wk enter sev-${evt.severity} pending`;
    li.innerHTML = `
      <div class="wk-head">
        <span class="wk-src">${PERSONA_LABEL[evt.agent_persona] || evt.agent_id || "AGENT"} · ${escapeHtml(evt.target_component || "")}</span>
        <span class="wk-sev">${sev.label}</span>
      </div>
      <div class="wk-verdict" data-verdict>▸ SCANNING…</div>`;
    el.bannerList.prepend(li);
    if (typeof evt.seq === "number") feedRows.set(evt.seq, li);
    while (el.bannerList.children.length > 7) {
      const gone = el.bannerList.lastChild;
      for (const [k, v] of feedRows) if (v === gone) feedRows.delete(k);
      gone.remove();
    }
    setTimeout(() => li.classList.remove("enter"), 600);
  }

  function resolveDetection(seq, msg) {
    if (msg.detected) tally.detected++; else tally.missed++;
    const li = feedRows.get(seq);
    if (!li) return;
    li.classList.remove("pending");
    li.classList.add(msg.detected ? "blocked" : "missed");
    const v = li.querySelector("[data-verdict]");
    if (v) {
      v.textContent = msg.detected
        ? `✓ BLOCKED · ${msg.rule || "rule"} · ${msg.latency_ms ?? "?"}ms`
        : `✗ MISSED · damage dealt`;
    }
  }

  // ── charts ──
  const hctx = el.chartHealth.getContext("2d");
  const bctx = el.chartBreak.getContext("2d");

  function drawCharts() { drawHealth(); drawDetectedMissed(); }

  function drawHealth() {
    const w = el.chartHealth.width, h = el.chartHealth.height;
    hctx.clearRect(0, 0, w, h);
    hctx.strokeStyle = "rgba(255,255,255,0.12)";
    hctx.lineWidth = 1;
    hctx.beginPath(); hctx.moveTo(0, h - 1); hctx.lineTo(w, h - 1); hctx.stroke();
    const n = healthHistory.length;
    if (n < 2) return;
    hctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w;
      const y = h - (healthHistory[i] / 100) * (h - 4) - 2;
      i ? hctx.lineTo(x, y) : hctx.moveTo(x, y);
    }
    hctx.strokeStyle = "#fff";
    hctx.lineWidth = 1.6;
    hctx.shadowColor = "rgba(255,255,255,0.8)";
    hctx.shadowBlur = 6;
    hctx.stroke();
    hctx.shadowBlur = 0;
    hctx.lineTo(w, h); hctx.lineTo(0, h); hctx.closePath();
    hctx.fillStyle = "rgba(255,255,255,0.06)";
    hctx.fill();
  }

  function drawDetectedMissed() {
    const w = el.chartBreak.width, h = el.chartBreak.height;
    bctx.clearRect(0, 0, w, h);
    const detected = stats ? stats.detected : tally.detected;
    const missed = stats ? stats.missed : tally.missed;
    const total = Math.max(1, detected + missed);
    const cov = Math.round((detected / total) * 100);

    // one horizontal stacked bar, monochrome (sunhacks): BLOCKED reads bright,
    // MISSED reads faint — share distinction via brightness, not hue.
    const barY = 18, barH = 26, pad = 8, bw = w - pad * 2;
    const dW = (detected / total) * bw;
    bctx.fillStyle = "rgba(255,255,255,0.85)";          // bright = blocked
    bctx.fillRect(pad, barY, dW, barH);
    bctx.fillStyle = "rgba(255,255,255,0.22)";          // faint = missed
    bctx.fillRect(pad + dW, barY, bw - dW, barH);
    bctx.strokeStyle = "rgba(255,255,255,0.25)";
    bctx.strokeRect(pad + 0.5, barY + 0.5, bw, barH);

    bctx.font = "9px monospace";
    bctx.textAlign = "left";
    bctx.fillStyle = "rgba(255,255,255,0.9)";
    bctx.fillText(`BLOCKED ${fmt(detected)}`, pad, barY - 5);
    bctx.textAlign = "right";
    bctx.fillText(`MISSED ${fmt(missed)}`, w - pad, barY - 5);

    bctx.textAlign = "center";
    bctx.font = "11px monospace";
    bctx.fillStyle = "#fff";
    bctx.fillText(`${cov}% COVERAGE`, w / 2, barY + barH + 16);
  }

  function fmt(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return String(n);
  }

  let toastTimer = null;
  function toast(msg) {
    let t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1500);
  }

  function toggleHud() { el.hud.classList.toggle("hidden"); }
  function tick() { drawCharts(); }

  return {
    setConnection, setTarget, setRun, setHealth, seedHealth, setSeq, setStats,
    updateAgent, pushDetectionPending, resolveDetection,
    toast, toggleHud, tick,
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
