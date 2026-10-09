// schema/event.ts
// Zod schema for the canonical agent → coordinator event (master.md §4.4).
// The runtime provides zod (~4.3.0); it is a devDependency here only for local
// typechecking and the local-mock harness.

import { z } from "zod";
import { PERSONAS, SEVERITIES } from "../agents/base";

export const severitySchema = z.enum(SEVERITIES);
export const personaSchema = z.enum(PERSONAS);

export const eventTypeSchema = z.enum([
  "attack_started",
  "weakness_found",
  "attack_result",
  "target_health",
]);

export const ghostEventSchema = z
  .object({
    // required (§4.4)
    run_id: z.string(),
    event_type: eventTypeSchema,
    agent_id: z.string(),
    agent_persona: personaSchema,
    ts: z.string(), // ISO-8601 w/ ms + Z

    // required on weakness_found / attack_result; optional otherwise
    severity: severitySchema.optional(),
    description: z.string().optional(),

    // optional (present in real mode, synthesized in mock)
    target_component: z.string().optional(),
    payload: z.string().optional(),
    http_status: z.number().int().optional(),
    evidence: z.string().optional(),
    src_ip: z.string().optional(),
  })
  // Enforce §4.4: severity + description are required on these two event types.
  .refine(
    (e) =>
      e.event_type === "weakness_found" || e.event_type === "attack_result"
        ? e.severity != null && e.description != null
        : true,
    { message: "severity and description are required on weakness_found / attack_result" },
  );

export type GhostEventParsed = z.infer<typeof ghostEventSchema>;
