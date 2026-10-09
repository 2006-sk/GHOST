// ── main ────────────────────────────────────────────────────────────────
// Wires the live feed to the 3D siege + HUD along TWO lanes (master.md §4.8):
//
//   VISUAL LANE  (`event`)      → a jet lunges at the tower NOW, never waiting
//                                 on the database. tower_health is authoritative.
//   ANALYTICS LANE (`detection`)→ arrives ms later, matched by `seq`:
//                                   detected → shield intercept (no fracture)
//                                   missed   → fracture + damage
//
// Each strike's impact point is remembered by `seq` so the shield/damage effect
// lands exactly where the jet hit, whenever the verdict shows up.

import { createStage } from "./scene/scene.js";
import { createTower } from "./scene/tower.js";
import { createEffects } from "./scene/effects.js";
import { createSwarm } from "./scene/swarm.js";
import { createHud } from "./ui/hud.js";
import { connectFeed } from "./net/wsClient.js";
import { createSimulator } from "./net/simulator.js";
import { startFlow } from "./ui/flow.js";
import { SEVERITY, API_BASE, START_URL, TOWER_PRESETS } from "./config.js";

const canvas = document.getElementById("stage");
const flashEl = document.getElementById("flash");

const stage = createStage(canvas);
let presetIdx = 0;
const tower = createTower(stage.scene, TOWER_PRESETS[presetIdx]);
const effects = createEffects(stage.scene);

// ── two-lane state, keyed by seq ──
const impacts = new Map();  // seq → { point, severity, agent_id, resolved }
const verdicts = new Map(); // seq → { detected, rule, latency_ms, confidence }
const LRU = 400;            // cap the maps so a long run doesn't grow forever
function trim(map) { if (map.size > LRU) { const k = map.keys().next().value; map.delete(k); } }

// Called by a jet the instant it reaches the surface (visual lane).
// We DON'T fracture here — we wait for the verdict to decide shield vs damage.
function onImpact(severity, point, evt) {
  const seq = evt?.seq;
  if (typeof seq !== "number") { damageHit(severity, point); return; } // bare event: old behaviour
  impacts.set(seq, { point: point.clone?.() || point, severity, agent_id: evt.agent_id, resolved: false });
  trim(impacts);
  if (verdicts.has(seq)) resolveImpact(seq);
  // else: verdict not here yet — resolveImpact fires when `detection` arrives.
}

// Resolve one strike once BOTH its impact point and its verdict are known.
function resolveImpact(seq) {
  const imp = impacts.get(seq);
  const v = verdicts.get(seq);
  if (!imp || !v || imp.resolved) return;
  imp.resolved = true;
  if (v.detected) shieldBlock(imp.severity, imp.point, v);
  else damageHit(imp.severity, imp.point);
}

// Detected → the shield holds. Bright cool intercept, a dome ripple, no fracture.
function shieldBlock(severity, point, v) {
  const sev = SEVERITY[severity] || SEVERITY.medium;
  effects.shieldHit(point, severity);
  tower.shieldPulse(point, severity);
  stage.shake(0.06 + sev.rank * 0.12);
  flashLevel = Math.min(0.9, 0.05 + sev.rank * 0.14);
  flashTint = "ok";
  bloomBoost = Math.min(2.0, 0.25 + sev.rank * 0.4);
  if (sev.rank >= 4) {
    hud.toast(`CRITICAL — INTERCEPTED in ${v?.latency_ms ?? "?"} ms`);
  }
}

// Missed → the hit lands. Outward shockwave + sparks + fracture + heavy shake.
function damageHit(severity, point) {
  const sev = SEVERITY[severity] || SEVERITY.medium;
  effects.shockwave(point, severity);
  effects.spark(point, severity);
  tower.hit(severity, point);
  stage.shake(0.18 + sev.rank * 0.34);
  flashLevel = Math.min(1, 0.12 + sev.rank * 0.22);
  flashTint = "miss";
  bloomBoost = Math.min(2.2, 0.3 + sev.rank * 0.5);
  if (sev.rank >= 4) hud.toast(`CRITICAL — BREACH, -${Math.abs(sev.damage)} integrity`);
}

const swarm = createSwarm(stage.scene, tower, effects, { onImpact });
const hud = createHud();
hud.setConnection("connecting");
hud.setTarget(`SURFACE · ${TOWER_PRESETS[presetIdx].toUpperCase()}`);

// ── event routing (visual lane) ──
function dispatch(evt) {
  // Real-mode correction frame: just heal/adjust health, don't re-animate.
  if (evt.corrected) {
    if (typeof evt.tower_health === "number") { tower.setHealth(evt.tower_health); hud.setHealth(evt.tower_health); }
    return;
  }
  if (typeof evt.tower_health === "number") { tower.setHealth(evt.tower_health); hud.setHealth(evt.tower_health); }
  if (typeof evt.seq === "number") hud.setSeq(evt.seq);
  const id = evt.agent_id;
  switch (evt.event_type) {
    case "attack_started":
      swarm.launch(id, evt);
      if (id) hud.updateAgent(id, "ATTACKING", evt.target_component);
      break;
    case "weakness_found":
      swarm.strike(id, evt);
      hud.pushDetectionPending(evt); // feed row created now, resolved on verdict
      if (id) hud.updateAgent(id, "ATTACKING", evt.target_component);
      break;
    case "attack_result":
      swarm.peel(id, evt);
      if (id) hud.updateAgent(id, "HELD", evt.target_component);
      break;
    case "target_health":
      tower.pulse();
      break;
  }
}

// ── detection routing (analytics lane) ──
function applyDetection(msg) {
  const seq = msg.seq;
  if (typeof seq !== "number") return;
  verdicts.set(seq, msg);
  trim(verdicts);
  resolveImpact(seq);
  hud.resolveDetection(seq, msg);              // flip the feed row to BLOCKED/MISSED
  // detection messages don't carry the agent; recover it from the stored strike.
  const id = impacts.get(seq)?.agent_id;
  if (id) hud.updateAgent(id, msg.detected ? "BLOCKED" : "BREACH");
}

function applyStats(msg) { hud.setStats(msg); }

function applySnapshot(msg) {
  const mode = msg.mode === "real" ? "live" : "mock";
  hud.setConnection(mode);
  if (typeof msg.run_id === "string") hud.setRun(msg.run_id);
  if (typeof msg.tower_health === "number") { tower.setHealth(msg.tower_health); hud.setHealth(msg.tower_health); }
  const events = Array.isArray(msg.events) ? msg.events : [];
  const healths = events.map((e) => e.tower_health).filter((v) => typeof v === "number");
  if (healths.length) hud.seedHealth(healths);
  const last = events[events.length - 1];
  if (last && typeof last.seq === "number") hud.setSeq(last.seq);
  if (msg.stats) hud.setStats(msg.stats);
}

// Rehearsal mode (?demo / ?sim) runs the built-in simulator ONLY — no live
// socket — so it's a clean, repeatable, zero-backend take for recording.
const q = new URLSearchParams(location.search);
const REHEARSAL = q.has("demo") || q.has("sim");

// ── client-side simulator. Declared before the feed because connectFeed()
// fires onStatus synchronously. ──
const sim = createSimulator({ onEvent: dispatch, onDetection: applyDetection, onStats: applyStats });

// ── live feed (skipped in rehearsal so the two sources never double-drive) ──
let feed = null;
if (!REHEARSAL) {
  feed = connectFeed({
    onSnapshot: applySnapshot,
    onEvent: dispatch,
    onDetection: applyDetection,
    onStats: applyStats,
    onStatus: (s) => { if (!sim.running) hud.setConnection(s === "live" ? "defending" : s); },
  });
}

// ── demo controls ──
async function triggerCritical() {
  hud.toast("CRITICAL INBOUND");
  if (REHEARSAL) { sim.critical(); return; } // self-contained rehearsal
  try {
    const r = await fetch(`${API_BASE}/trigger/critical`, { method: "GET" });
    if (r.ok) return;
  } catch {}
  sim.critical(); // fallback so the money shot always works even with no backend
}

async function triggerReset() {
  hud.toast("RESET");
  if (REHEARSAL) { sim.reset(); tower.setHealth(100); hud.setHealth(100); return; }
  try { await fetch(`${API_BASE}/reset`, { method: "GET" }); } catch {}
  tower.setHealth(100); hud.setHealth(100);
}

// ── keyboard ──
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "s") {
    if (sim.running) { sim.stop(); hud.toast("SIM OFF"); hud.setConnection("defending"); }
    else { sim.setHealth(100); sim.start(); hud.toast("SIM ON"); hud.setConnection("sim"); }
  } else if (k === "c") {
    triggerCritical();
  } else if (k === "r") {
    triggerReset();
  } else if (k === "t") {
    presetIdx = (presetIdx + 1) % TOWER_PRESETS.length;
    setPreset(presetIdx);
  } else if (k === "h") {
    hud.toggleHud();
  } else if (k >= "1" && k <= "6") {
    const i = Number(k) - 1;
    if (i < TOWER_PRESETS.length) { presetIdx = i; setPreset(i); }
  }
});

function setPreset(i) {
  tower.build(TOWER_PRESETS[i]);
  swarm.recenter?.(Math.max(6, tower.bounds.height * 0.5));
  hud.setTarget(`SURFACE · ${TOWER_PRESETS[i].toUpperCase()}`);
  hud.toast(TOWER_PRESETS[i].toUpperCase());
}

if (START_URL) hud.setTarget(START_URL);

// ── ?demo / ?sim : zero-backend rehearsal (no Coordinator needed) ──
if (REHEARSAL) {
  // zero-backend rehearsal: skip the folder/loading overlays, straight to siege
  const fs = document.getElementById("screen-folder");
  const ls = document.getElementById("screen-loading");
  if (fs) fs.hidden = true;
  if (ls) ls.hidden = true;
  hud.setRun("run_rehearsal");
  sim.setHealth(100);
  sim.start();
  hud.setConnection("sim");
  if (q.has("critical")) setTimeout(triggerCritical, 2600);
} else {
  startFlow({ sim, hud });
}

// ── render loop ──
let flashLevel = 0;
let flashTint = "miss";
let bloomBoost = 0;
const BLOOM_BASE = 0.9;
let last = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  tower.update(dt);
  swarm.update(dt);
  effects.update(dt);

  if (flashLevel > 0.001) {
    flashLevel *= Math.pow(0.0009, dt);
    flashEl.style.opacity = flashLevel.toFixed(3);
    flashEl.dataset.tint = flashTint;
  } else if (flashEl.style.opacity !== "0") {
    flashEl.style.opacity = "0";
  }
  if (bloomBoost > 0.001) bloomBoost *= Math.pow(0.02, dt);
  stage.setBloom(BLOOM_BASE + bloomBoost);

  stage.render(dt);
  hud.tick();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// expose for console debugging during the demo
window.__siege = { tower, swarm, sim, dispatch, applyDetection, setPreset };
