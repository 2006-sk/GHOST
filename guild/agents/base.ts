// agents/base.ts
// ---------------------------------------------------------------------------
// Shared, SDK-agnostic core for all six GHOST red-team personas.
//
// SCOPE: MOCK mode only. This module BUILDS canonical events (master.md §4.4)
// and returns them as plain data. It performs NO network I/O and executes NO
// attacks. Every "attack" is a scripted LABEL — a detection signature — pushed
// into the detection pipeline so the defensive side can prove it catches them.
// There is no exploit delivery, no flooding, no payload execution here.
//
// Real-mode autonomous exploitation of a live target is intentionally OUT OF
// SCOPE for this build (see /guild/README.md → "Real mode").
// ---------------------------------------------------------------------------

export const PERSONAS = [
  "recon",
  "netscan",
  "injection",
  "auth_bypass",
  "dos",
  "logic_abuse",
] as const;
export type Persona = (typeof PERSONAS)[number];

// §4.1 fixed agent_id ↔ persona mapping. DO NOT renumber.
export const AGENT_ID: Record<Persona, string> = {
  recon: "agent-1",
  netscan: "agent-2",
  injection: "agent-3",
  auth_bypass: "agent-4",
  dos: "agent-5",
  logic_abuse: "agent-6",
};

export const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

// §4.2 ranks are kept for reference / playbook sanity-checks ONLY.
// Agents NEVER send health_delta — the coordinator owns damage. We do not
// apply these here.
export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export type EventType =
  | "attack_started"
  | "weakness_found"
  | "attack_result" // held / no weakness
  | "target_health"; // heartbeat (emitted by the target/coordinator, not here)

// Canonical agent → coordinator event (master.md §4.4).
// NOTE: health_delta, seq, tower_health are deliberately ABSENT — coordinator-owned.
export interface GhostEvent {
  run_id: string;
  event_type: EventType;
  agent_id: string;
  agent_persona: Persona;
  target_component?: string;
  severity?: Severity;
  description?: string;
  payload?: string;
  http_status?: number;
  evidence?: string;
  src_ip?: string;
  ts: string; // ISO-8601 with milliseconds and Z
}

// A scripted technique line in a persona playbook. `payload`/`desc` are static
// labels; `land_rate` is the scripted probability the technique "lands" in a
// MOCK wave (nothing is actually attempted).
export interface Technique {
  payload: string;
  desc: string;
  severity: Severity;
  land_rate: number; // 0..1
}

export interface Playbook {
  persona: Persona;
  components: string[];
  techniques: Technique[];
}

// Findings recon seeds for the other personas (MOCK shared memory).
export interface SharedFindings {
  components: string[];
  notes: string[];
}

// --- deterministic-with-jitter helpers -------------------------------------
// A given run_id replays identically on stage, but personas differ and waves
// vary. Seeded so the demo is reproducible (master.md §5: "deterministic + a
// little randomness").

export function makeRng(seedStr: string): () => number {
  // FNV-1a seed → xorshift32 stream.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0;
  if (s === 0) s = 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return (s >>> 0) / 0xffffffff;
  };
}

export function nowIso(): string {
  // toISOString() yields e.g. 2026-10-09T18:22:01.123Z (ms + Z) per §4.
  return new Date().toISOString();
}

function synthSrcIp(rng: () => number): string {
  const octet = 2 + Math.floor(rng() * 250);
  return `10.0.0.${octet}`;
}

function synthStatus(landed: boolean, sev: Severity, rng: () => number): number {
  if (!landed) return 200;
  if (sev === "critical" || sev === "high") return rng() < 0.5 ? 500 : 200;
  return rng() < 0.5 ? 200 : 403;
}

function synthEvidence(tech: Technique, rng: () => number): string {
  // A benign, human-readable evidence string for the HUD/banner. Synthetic.
  const n = 100 + Math.floor(rng() * 2000);
  switch (tech.severity) {
    case "critical":
      return `anomalous response · ${n} rows / objects affected`;
    case "high":
      return `unexpected ${n}-byte response delta`;
    case "medium":
      return `reflected / unescaped in response (${n} bytes)`;
    default:
      return `observed response code change`;
  }
}

// --- event builders --------------------------------------------------------

export function attackStarted(
  run_id: string,
  persona: Persona,
  component: string,
  ts: string,
  src_ip?: string,
): GhostEvent {
  return {
    run_id,
    event_type: "attack_started",
    agent_id: AGENT_ID[persona],
    agent_persona: persona,
    target_component: component,
    description: `${persona} probing ${component}`,
    src_ip,
    ts,
  };
}

export function weaknessFound(
  run_id: string,
  persona: Persona,
  component: string,
  tech: Technique,
  status: number,
  src_ip: string,
  evidence: string,
  ts: string,
): GhostEvent {
  return {
    run_id,
    event_type: "weakness_found",
    agent_id: AGENT_ID[persona],
    agent_persona: persona,
    target_component: component,
    severity: tech.severity, // required on weakness_found (§4.4)
    description: tech.desc, // required on weakness_found (§4.4)
    payload: tech.payload, // synthesized label in mock (§4.4: optional)
    http_status: status,
    evidence,
    src_ip,
    ts,
  };
}

export function attackResult(
  run_id: string,
  persona: Persona,
  component: string,
  tech: Technique,
  src_ip: string,
  ts: string,
): GhostEvent {
  // "held / no weakness" (§4.3). severity + description still required (§4.4).
  return {
    run_id,
    event_type: "attack_result",
    agent_id: AGENT_ID[persona],
    agent_persona: persona,
    target_component: component,
    severity: "info",
    description: `${tech.desc} — held, no weakness`,
    payload: tech.payload,
    http_status: 200,
    src_ip,
    ts,
  };
}

// --- MOCK wave runner ------------------------------------------------------

export interface MockRunOptions {
  seed: string;
  waves?: number;
}

function defaultWaves(persona: Persona): number {
  // recon runs first and short; the rest run a handful of waves.
  return persona === "recon" ? 3 : 5;
}

function pickComponent(
  pb: Playbook,
  reconComponents: string[] | undefined,
  rng: () => number,
): string {
  // Prefer recon's discovered components when present (shared memory), else
  // fall back to the persona's own component list.
  const pool =
    reconComponents && reconComponents.length
      ? [...pb.components, ...reconComponents]
      : pb.components;
  return pool[Math.floor(rng() * pool.length)] ?? pb.components[0] ?? "/";
}

function pickTechnique(pb: Playbook, rng: () => number, escalateIdx: number): Technique {
  // Escalation: once something lands, bias toward higher-ranked techniques on
  // the next wave. `escalateIdx` is clamped by the caller.
  if (rng() < 0.5 && pb.techniques[escalateIdx]) {
    return pb.techniques[escalateIdx];
  }
  return pb.techniques[Math.floor(rng() * pb.techniques.length)] ?? pb.techniques[0];
}

/**
 * Produce the scripted MOCK event stream for one persona's run.
 * Pure function: no I/O, no side effects, fully reproducible from `seed`.
 */
export function runMockWaves(
  run_id: string,
  persona: Persona,
  pb: Playbook,
  reconComponents: string[] | undefined,
  opts: MockRunOptions,
): GhostEvent[] {
  const rng = makeRng(opts.seed);
  const waves = opts.waves ?? defaultWaves(persona);
  const events: GhostEvent[] = [];
  let escalateIdx = 0;

  for (let w = 0; w < waves; w++) {
    const component = pickComponent(pb, reconComponents, rng);
    const tech = pickTechnique(pb, rng, escalateIdx);
    const src_ip = synthSrcIp(rng);

    events.push(attackStarted(run_id, persona, component, nowIso(), src_ip));

    const landed = rng() < tech.land_rate;
    if (landed) {
      const status = synthStatus(true, tech.severity, rng);
      const evidence = synthEvidence(tech, rng);
      events.push(
        weaknessFound(run_id, persona, component, tech, status, src_ip, evidence, nowIso()),
      );
      // escalate toward higher-ranked techniques next wave
      escalateIdx = Math.min(escalateIdx + 1, pb.techniques.length - 1);
    } else {
      events.push(attackResult(run_id, persona, component, tech, src_ip, nowIso()));
    }
  }

  return events;
}
