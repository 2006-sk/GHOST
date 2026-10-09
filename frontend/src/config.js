// ── Shared truth: mirrors tower-siege/src/contract.mjs ──────────────────
// The frontend consumes the Coordinator's WebSocket feed. Two message kinds:
//   { kind: "snapshot", tower_health, events:[...enriched], briefing }
//   { kind: "event", event_type, agent_id, agent_persona, target_component,
//     severity, description, health_delta, timestamp, tower_health, seq }
// Keep this file in lockstep with the backend contract.

const params = new URLSearchParams(location.search);

// Where the live feed lives. Same host:8080 for both the mock and the real
// Coordinator, so swapping mock → real is literally "run the other server".
export const WS_URL =
  params.get("ws") || `ws://${location.hostname || "localhost"}:8080/ws`;

// HTTP base for optional demo triggers (the mock exposes /trigger/*; the real
// Coordinator won't, and we fall back to a client-side critical gracefully).
export const API_BASE =
  params.get("api") || `http://${location.hostname || "localhost"}:8080`;

export const EVENT_TYPES = ["attack_started", "attack_result", "weakness_found", "target_health"];

export const SEVERITY = {
  info:     { rank: 0, damage: 0,   label: "INFO" },
  low:      { rank: 1, damage: -3,  label: "LOW" },
  medium:   { rank: 2, damage: -8,  label: "MEDIUM" },
  high:     { rank: 3, damage: -15, label: "HIGH" },
  critical: { rank: 4, damage: -30, label: "CRITICAL" },
};

// §4.1 GHOST roster — SIX agents, fixed agent_id↔persona (matches the coordinator
// + guild). color/hex span yellow→indigo; `brain` is the fast Nebius model.
export const AGENTS = [
  { id: "agent-1", persona: "recon",       label: "RECON",       tag: "MAP",             color: 0xffe14d, hex: "#ffe14d", brain: "DeepSeek-V4-Flash",      blurb: "Fingerprints the target and maps its attack surface, seeding shared memory for the rest of the swarm." },
  { id: "agent-2", persona: "netscan",     label: "NET-SCAN",    tag: "PORTS/SVC",       color: 0xff9e3d, hex: "#ff9e3d", brain: "Nemotron-3.5-Lightning", blurb: "Sweeps ports and services, enumerating exposed databases, debug ports and admin surfaces." },
  { id: "agent-3", persona: "injection",   label: "INJECTION",   tag: "SQLi/XSS/PROMPT", color: 0xb6ff3d, hex: "#b6ff3d", brain: "GLM-5.3-Flash",          blurb: "Probes every input: SQL injection, reflected XSS, and prompt injection against any LLM-facing endpoint." },
  { id: "agent-4", persona: "auth_bypass", label: "AUTH-BYPASS", tag: "IDOR/JWT",        color: 0x3dffd6, hex: "#3dffd6", brain: "GLM-5.3-Flash",          blurb: "Reaches what it shouldn't: IDOR, missing authorization, forged tokens (alg:none), and info disclosure." },
  { id: "agent-5", persona: "dos",         label: "DoS",         tag: "FLOOD",           color: 0x3db4ff, hex: "#3db4ff", brain: "Nemotron-3-Ultra",       blurb: "Tests resource handling and missing rate limits with bounded, non-destructive bursts." },
  { id: "agent-6", persona: "logic_abuse", label: "LOGIC-ABUSE", tag: "BIZ-LOGIC",       color: 0x5b6bff, hex: "#5b6bff", brain: "Nemotron-3-Ultra",       blurb: "Breaks business-logic assumptions: coupon stacking, negative amounts, and transfer theft." },
];

export const AGENT_BY_ID = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
export const CRITICAL_COLOR = 0xff2d55; // hot red — flags a critical strike

export const PERSONA_LABEL = Object.fromEntries(AGENTS.map((a) => [a.persona, a.label]));

// Preset "targets" — the tower can be any object; all render as white line-art.
export const TOWER_PRESETS = ["tower", "core", "server", "reactor", "pyramid", "citadel"];

export const START_URL = params.get("target") || null; // optional named target label

// ── Hardcoded fallback switch ──
// false → real: the folder-select screen talks to the backend orchestrator,
//   which boots TowerBank inside a Wasmer sandbox and runs the real swarm.
// true  → the client-side simulator drives a canned siege with no backend.
// Query override: ?fallback=1 forces it on for a zero-backend rehearsal.
export const USE_FALLBACK = params.get("fallback") === "0" ? false : true;
