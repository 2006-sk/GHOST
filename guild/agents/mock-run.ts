// agents/mock-run.ts
// Builds a persona's EventsOutput for MOCK mode. SDK-free and side-effect-free
// so it can be driven both by a Guild agent `run()` and by the local-mock
// harness (orchestration/local-mock.ts) with no Guild runtime at all.
import { runMockWaves, AGENT_ID, type Persona } from "./base";
import type { SessionInput, EventsOutput } from "../schema/session-input";
import { playbooks } from "../playbooks";

export function buildMockOutput(persona: Persona, input: SessionInput): EventsOutput {
  const pb = playbooks[persona];
  const events = runMockWaves(input.run_id, persona, pb, input.shared_memory.components, {
    seed: `${input.run_id}:${persona}`,
  });

  // recon seeds shared memory (routes/notes) for the other personas.
  const findings =
    persona === "recon"
      ? {
          components: pb.components.filter((c) => c.startsWith("/")),
          notes: pb.techniques.map((t) => t.desc),
        }
      : { components: [], notes: [] };

  return {
    run_id: input.run_id,
    agent_id: AGENT_ID[persona],
    agent_persona: persona,
    mode: input.mode,
    events,
    findings,
  };
}
