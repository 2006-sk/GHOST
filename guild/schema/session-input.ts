// schema/session-input.ts
// Zod schemas for what every GHOST agent accepts (master.md §4.7) and returns.
// Kenil owns §4.7. One addition vs. the doc — `shared_memory` — is explained
// below; it does NOT change the coordinator-facing wire contract (§4.4).

import { z } from "zod";
import { personaSchema, ghostEventSchema } from "./event";

// Findings recon seeds for the other personas. In this MOCK build the
// orchestrator copies recon's `findings` into each later agent's
// `shared_memory` input. `shared_memory_ref` from §4.7 is kept as the stable
// identifier; a production upgrade can swap this for Guild's own shared store
// (task.guild / task.save) keyed by that ref — see README.
export const sharedFindingsSchema = z.object({
  components: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});

// master.md §4.7 — the typed input every agent session receives.
export const sessionInputSchema = z.object({
  run_id: z.string(),
  mode: z.enum(["mock", "real"]),
  agent_persona: personaSchema,
  target: z.object({
    base_url: z.string(),
    tool: z.string().default("target_http"),
  }),
  emit_url: z.string(),
  shared_memory_ref: z.string(),
  intensity: z.enum(["demo", "full"]).default("demo"),

  // Kenil extension (MOCK shared memory; empty for recon, seeded for the rest).
  shared_memory: sharedFindingsSchema.default({ components: [], notes: [] }),
});

export type SessionInput = z.infer<typeof sessionInputSchema>;

// What each agent returns. The orchestrator forwards `events` to the
// coordinator /events (exact §4.4 JSON) and copies recon's `findings` into the
// other agents' `shared_memory`.
export const eventsOutputSchema = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_persona: personaSchema,
  mode: z.enum(["mock", "real"]),
  events: z.array(ghostEventSchema),
  findings: sharedFindingsSchema.default({ components: [], notes: [] }),
});

export type EventsOutput = z.infer<typeof eventsOutputSchema>;
