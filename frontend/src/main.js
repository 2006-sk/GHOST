// ── main ────────────────────────────────────────────────────────────────
// Wires the live feed to the 3D siege + HUD. One dispatch() routes every
// event to both the scene and the HUD; impacts are fired at the instant a jet
// actually reaches the tower, so damage, flash, shake and fracture land in
// sync with the strike.

import { createStage } from "./scene/scene.js";
import { createTower } from "./scene/tower.js";
import { createEffects } from "./scene/effects.js";
import { createSwarm } from "./scene/swarm.js";
import { createHud } from "./ui/hud.js";
import { connectFeed } from "./net/wsClient.js";
import { createSimulator } from "./net/simulator.js";
import { startFlow } from "./ui/flow.js";
import { createReport } from "./ui/report.js";
import { SEVERITY, API_BASE, START_URL, TOWER_PRESETS, CRITICAL_COLOR } from "./config.js";

const canvas = document.getElementById("stage");
const flashEl = document.getElementById("flash");

const stage = createStage(canvas);
let presetIdx = 0;
const tower = createTower(stage.scene, TOWER_PRESETS[presetIdx]);
const effects = createEffects(stage.scene);

// Global impact: called by a jet the moment it reaches the surface.
function onImpact(severity, point, agent) {
  const sev = SEVERITY[severity] || SEVERITY.medium;
  const critical = severity === "critical";
  const color = critical ? CRITICAL_COLOR : (agent?.color ?? 0xffffff);
  effects.shockwave(point, severity, color);
  effects.spark(point, severity, color);
  tower.hit(severity, point);
  stage.shake(0.18 + sev.rank * 0.34);
  flashLevel = Math.min(1, 0.12 + sev.rank * 0.22);
  bloomBoost = Math.min(2.2, 0.3 + sev.rank * 0.5);
  if (critical) {
    const v = point.clone().project(stage.camera);
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    report.flagCritical(x, y, agent?.label || "");
  }
}

const swarm = createSwarm(stage.scene, tower, effects, { onImpact });
const hud = createHud();
const report = createReport({ onRelaunch: () => relaunch() });
async function relaunch() {
  currentRun = null;                 // re-lock to whatever run comes next
  tower.setHealth(100); hud.setHealth(100);
  if (sim.running) { sim.setHealth(100); return; }
  try { await fetch(`${API_BASE}/api/run`, { method: "POST" }); } catch {}
}
hud.setConnection("connecting");
hud.setTarget(`SURFACE · ${TOWER_PRESETS[presetIdx].toUpperCase()}`);

// ── event routing ──
const lastLabel = {};
// Run-lock: the coordinator broadcasts every run to every client, so if two runs
// emit at once (e.g. a stray mock-loop + the real siege) their tower_health
// values interleave and the integrity bar glitches. Lock onto the first run we
// see and ignore events from any other run_id until a relaunch clears it.
let currentRun = null;
function dispatch(evt) {
  if (evt && evt.run_id) {
    if (!currentRun) currentRun = evt.run_id;
    else if (evt.run_id !== currentRun) return; // stray run → ignore (no glitch)
  }
  // A run starts with a "siege begins" heartbeat — clear the previous run's
  // findings + integrity chart so each siege is clean (and results aren't
  // wiped mid-run by a stray health-100 event).
  if (evt.event_type === "target_health" && evt.description === "siege begins") { report.reset?.(); hud.resetHealth?.(); }
  // The coordinator sends "siege complete" when events stop → roll to results.
  if (evt.event_type === "target_health" && evt.description === "siege complete") {
    setTimeout(() => report.forceShow?.(), 1200); // let the last strikes animate first
    return;
  }
  report.record(evt);
  if (typeof evt.tower_health === "number") { tower.setHealth(evt.tower_health); hud.setHealth(evt.tower_health); report.maybeFinish(evt.tower_health); }
  if (typeof evt.seq === "number") hud.setSeq(evt.seq);
  const id = evt.agent_id;
  switch (evt.event_type) {
    case "attack_started":
      swarm.launch(id, evt);
      if (id) hud.updateAgent(id, "ATTACKING", evt.target_component);
      break;
    case "weakness_found":
      swarm.strike(id, evt);
      hud.pushWeakness(evt);
      if (id) hud.updateAgent(id, "STRIKE", evt.target_component);
      break;
    case "attack_result":
      swarm.peel(id, evt);
      if (id) hud.updateAgent(id, "PEELED", evt.target_component);
      break;
    case "target_health":
      tower.pulse();
      break;
  }
}

function applySnapshot(msg) {
  hud.setConnection(msg.mock ? "mock" : "live");
  if (typeof msg.tower_health === "number") { tower.setHealth(msg.tower_health); hud.setHealth(msg.tower_health); }
  const events = Array.isArray(msg.events) ? msg.events : [];
  // seed the integrity chart + counters from history without animating the flood
  const healths = events.map((e) => e.tower_health).filter((v) => typeof v === "number");
  if (healths.length) hud.seedHealth(healths);
  for (const e of events) if (e.event_type === "weakness_found") hud.countWeakness(e);
  const last = events[events.length - 1];
  if (last && typeof last.seq === "number") hud.setSeq(last.seq);
}

// ── client-side simulator (rehearsal / zero-backend) ──
// Declared before the feed: connectFeed() fires onStatus synchronously, and
// that callback reads sim.running.
const sim = createSimulator(dispatch);

// ── live feed ──
const feed = connectFeed({
  // While the client-side simulator is driving (fallback mode), ignore the
  // backend feed — otherwise its health-100 snapshots interleave with the
  // sim's declining values and spike the integrity chart back to 100.
  onSnapshot: (msg) => { if (!sim.running) applySnapshot(msg); },
  onEvent: (evt) => { if (!sim.running) dispatch(evt); },
  onStatus: (s) => { if (!sim.running) hud.setConnection(s === "live" ? "live" : s); },
});

// ── critical trigger: prefer the mock's HTTP endpoint, else client-side ──
async function triggerCritical() {
  hud.toast("CRITICAL INBOUND");
  try {
    const r = await fetch(`${API_BASE}/trigger/critical`, { method: "GET" });
    if (r.ok) return;
  } catch {}
  sim.critical(); // fallback so the money shot always works
}

async function triggerReset() {
  hud.toast("RESET");
  try { await fetch(`${API_BASE}/reset`, { method: "GET" }); } catch {}
  sim.reset();
  tower.setHealth(100); hud.setHealth(100);
}

// ── keyboard ──
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "s") {
    if (sim.running) { sim.stop(); hud.toast("SIM OFF"); hud.setConnection("live"); }
    else { sim.setHealth(100); sim.start(); hud.toast("SIM ON"); hud.setConnection("sim"); }
  } else if (k === "c") {
    triggerCritical();
  } else if (k === "e") {
    report.forceShow?.();              // show the breach / findings report on demand
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

// ── ?demo / ?sim : auto-run the built-in simulator with no backend at all.
// Handy for rehearsing the video (README watch-out #2) and for a zero-setup
// "just open the URL" demo. ?critical also fires the money shot on a timer.
const q = new URLSearchParams(location.search);
if (q.has("demo") || q.has("sim")) {
  // zero-backend rehearsal: straight into the siege with the simulator
  sim.setHealth(100);
  sim.start();
  hud.setConnection("sim");
  if (q.has("critical")) setTimeout(triggerCritical, 2600);
} else {
  // default: folder-select → loading (wait for Wasmer) → command center
  startFlow({ sim, hud, onFallback: () => sim.playRealistic({ durationMs: 30000, onComplete: () => report.noteRunEnded() }) });
}

// ── live Wasmer proof badge ──
// Polls the backend for real sandbox metadata (runtime, package, boot time,
// generation) so judges can SEE the target runs inside a live Wasmer sandbox.
// The respawn button destroys + re-boots the sandbox on demand (generation ++).
const wasmerBadge = document.getElementById("wasmer-badge");
let prevRunning = false;
async function pollWasmer() {
  try {
    const s = await (await fetch(`${API_BASE}/api/status`)).json();
    if (prevRunning && !s.running) report.noteRunEnded(); // run ended → results may show
    prevRunning = s.running;
    const sb = s.sandbox;
    if (sb && sb.running) {
      wasmerBadge.style.display = "flex";
      wasmerBadge.innerHTML =
        `<span class="hex">⬢</span><div>` +
        `<div><b>Guild</b> <span class="k">Session</span> · <span class="live">LIVE</span></div>` +
        `<div class="k">${sb.package || "python"} · session&nbsp;#${sb.generation} · boot ${sb.boot_ms ?? "?"}ms</div>` +
        `</div><button class="respawn" id="respawn">↻ respawn</button>`;
      const rb = document.getElementById("respawn");
      if (rb) rb.onclick = async () => { rb.textContent = "respawning…"; try { await fetch(`${API_BASE}/api/reset`, { method: "POST" }); } catch {} hud.toast?.("GUILD SESSION RESTARTED"); };
    } else if (s.mode === "wasmer" && s.phase === "booting") {
      wasmerBadge.style.display = "flex";
      wasmerBadge.innerHTML = `<span class="hex">⬢</span><span class="k">starting Guild session…</span>`;
    }
  } catch {}
  setTimeout(pollWasmer, 3000);
}
pollWasmer();

// ── render loop ──
let flashLevel = 0;
let bloomBoost = 0;
const BLOOM_BASE = 0.9;
let last = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  tower.update(dt);
  swarm.update(dt);
  effects.update(dt);

  // flash + bloom decay
  if (flashLevel > 0.001) { flashLevel *= Math.pow(0.0009, dt); flashEl.style.opacity = flashLevel.toFixed(3); }
  else if (flashEl.style.opacity !== "0") flashEl.style.opacity = "0";
  if (bloomBoost > 0.001) bloomBoost *= Math.pow(0.02, dt);
  stage.setBloom(BLOOM_BASE + bloomBoost);

  // sync roster labels with actual jet state
  for (const j of swarm.jets) {
    if (lastLabel[j.agent.id] !== j.stateLabel) {
      hud.updateAgent(j.agent.id, j.stateLabel);
      lastLabel[j.agent.id] = j.stateLabel;
    }
  }

  stage.render(dt);
  hud.tick();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// expose for console debugging during the demo
window.__siege = { tower, swarm, sim, dispatch, setPreset, report };
