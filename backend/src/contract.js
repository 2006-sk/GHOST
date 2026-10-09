// contract.js — mirror of master.md §4. Single source of truth at runtime.
// If this and master.md disagree, fix here and announce the contract change.

// §4.1 Agent roster (fixed — do not renumber)
export const AGENTS = {
  'agent-1': { persona: 'recon', hud: 'MAP' },
  'agent-2': { persona: 'netscan', hud: 'PORTS/SVC' },
  'agent-3': { persona: 'injection', hud: 'SQLi/XSS/PROMPT' },
  'agent-4': { persona: 'auth_bypass', hud: 'IDOR/JWT' },
  'agent-5': { persona: 'dos', hud: 'FLOOD' },
  'agent-6': { persona: 'logic_abuse', hud: 'BIZ-LOGIC' },
  // agent-7: SEMGREP — the static-analysis agent. It reads the target's source
  // (not the running app) and emits its findings as weaknesses into the siege.
  'agent-7': { persona: 'semgrep', hud: 'STATIC/SAST' },
};

export const PERSONAS = Object.values(AGENTS).map((a) => a.persona);

// §4.2 Severity → damage (coordinator applies; agents never send health_delta)
export const SEVERITY = {
  info: { rank: 0, damage: 0 },
  low: { rank: 1, damage: -3 },
  medium: { rank: 2, damage: -8 },
  high: { rank: 3, damage: -15 },
  critical: { rank: 4, damage: -30 },
};

// §4.3 Event types
export const EVENT_TYPES = new Set([
  'attack_started',
  'weakness_found',
  'attack_result',
  'target_health',
]);

// Events that carry a severity+description and can deal damage.
export const SCORED_TYPES = new Set(['weakness_found', 'attack_result']);

export const MAX_HEALTH = 100;
export const MIN_HEALTH = 0;

export function clampHealth(h) {
  return Math.max(MIN_HEALTH, Math.min(MAX_HEALTH, h));
}

// Validate an incoming Agent → Coordinator event (§4.4).
// Returns { ok: true } or { ok: false, error }. Never throws.
export function validateEvent(e) {
  if (!e || typeof e !== 'object') return { ok: false, error: 'body is not an object' };

  const required = ['run_id', 'event_type', 'agent_id', 'agent_persona', 'ts'];
  for (const k of required) {
    if (e[k] === undefined || e[k] === null || e[k] === '') {
      return { ok: false, error: `missing required field: ${k}` };
    }
  }

  if (!EVENT_TYPES.has(e.event_type)) {
    return { ok: false, error: `unknown event_type: ${e.event_type}` };
  }

  if (!AGENTS[e.agent_id]) {
    return { ok: false, error: `unknown agent_id: ${e.agent_id}` };
  }

  if (SCORED_TYPES.has(e.event_type)) {
    if (!e.severity || !SEVERITY[e.severity]) {
      return { ok: false, error: `missing/invalid severity on ${e.event_type}` };
    }
    if (!e.description) {
      return { ok: false, error: `missing description on ${e.event_type}` };
    }
  }

  return { ok: true };
}
