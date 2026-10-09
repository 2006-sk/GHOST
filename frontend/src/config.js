// ── Shared truth ────────────────────────────────────────────────────────
// The frontend consumes the GHOST Coordinator's WebSocket feed (master.md §4.5).
// FOUR message kinds:
//   { kind:"snapshot", run_id, mode:"mock"|"real", tower_health, events:[…], stats }
//   { kind:"event",     run_id, seq, event_type, agent_id, agent_persona,
//                        target_component, severity, description, health_delta, tower_health, ts }
//   { kind:"detection", run_id, seq, detected, rule, latency_ms, confidence }
//   { kind:"stats",     run_id, coverage_pct, mttd_ms, total_events, detected, missed, by_persona, by_severity }
// Keep this file in lockstep with backend/src/contract.js.

const params = new URLSearchParams(location.search);

// Vite exposes import.meta.env.VITE_* (set in a .env or the shell). Priority:
//   ?ws= / ?api=  →  VITE_WS_URL / VITE_API_BASE  →  same-host :8080 default.
const ENV = (typeof import.meta !== "undefined" && import.meta.env) || {};
const host = location.hostname || "localhost";

// The real Coordinator mounts the socket at /ws (backend/src/ws.js). The bundled
// mock-server also serves /ws, so the default works for both.
export const WS_URL =
  params.get("ws") || ENV.VITE_WS_URL || `ws://${host}:8080/ws`;

// HTTP base for the demo triggers (/api/*, /trigger/critical, /reset).
export const API_BASE =
  params.get("api") || ENV.VITE_API_BASE || `http://${host}:8080`;

export const EVENT_TYPES = ["attack_started", "weakness_found", "attack_result", "target_health"];

// §4.2 severity → damage. Severity reads through brightness/weight, never hue alone.
export const SEVERITY = {
  info:     { rank: 0, damage: 0,   label: "INFO" },
  low:      { rank: 1, damage: -3,  label: "LOW" },
  medium:   { rank: 2, damage: -8,  label: "MEDIUM" },
  high:     { rank: 3, damage: -15, label: "HIGH" },
  critical: { rank: 4, damage: -30, label: "CRITICAL" },
};

// §4.1 agent roster — FIXED, do not renumber. One jet per agent.
export const AGENTS = [
  { id: "agent-1", persona: "recon",       label: "RECON",       tag: "MAP" },
  { id: "agent-2", persona: "netscan",     label: "NET-SCAN",    tag: "PORTS/SVC" },
  { id: "agent-3", persona: "injection",   label: "INJECTION",   tag: "SQLi/XSS/PROMPT" },
  { id: "agent-4", persona: "auth_bypass", label: "AUTH-BYPASS", tag: "IDOR/JWT" },
  { id: "agent-5", persona: "dos",         label: "DoS",         tag: "FLOOD" },
  { id: "agent-6", persona: "logic_abuse", label: "LOGIC-ABUSE", tag: "BIZ-LOGIC" },
];

export const PERSONA_LABEL = Object.fromEntries(AGENTS.map((a) => [a.persona, a.label]));
export const AGENT_OF = Object.fromEntries(AGENTS.map((a) => [a.persona, a.id]));

// Preset "targets" — the tower can be any object; all render as white line-art.
export const TOWER_PRESETS = ["tower", "core", "server", "reactor", "pyramid", "citadel"];

export const START_URL = params.get("target") || null;

// Zero-backend rehearsal: ?demo / ?sim drive the built-in simulator (see main.js).
// ?fallback=1 forces the folder-select screen straight to the simulator.
export const USE_FALLBACK = params.get("fallback") === "1";
