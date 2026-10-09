// orchestration/local-mock.ts
// Plain Node (run with tsx). Produces the full six-persona MOCK event stream
// WITHOUT Guild at all — so the detection loop + frontend can run even if Guild
// wobbles (master.md §5 MOCK, §8 "the visual siege alone must carry the demo").
//
//   npm run mock        # print the merged event stream as JSON (stdout)
//   npm run mock:post   # also POST every event to $EMIT_URL (coordinator /events)
//
// Env:
//   RUN_ID    default "run_local_01"
//   EMIT_URL  default "http://localhost:8080/events"  (used only with --post)

import { PERSONAS, type Persona, type SharedFindings } from "../agents/base";
import { buildMockOutput } from "../agents/mock-run";
import { sessionInputSchema, type SessionInput } from "../schema/session-input";
import { forwardEvents } from "./forward-events";

const RUN_ID = process.env.RUN_ID ?? "run_local_01";
const EMIT_URL = process.env.EMIT_URL ?? "http://localhost:8080/events";
const POST = process.argv.includes("--post");

function makeInput(persona: Persona, shared: SharedFindings): SessionInput {
  return sessionInputSchema.parse({
    run_id: RUN_ID,
    mode: "mock",
    agent_persona: persona,
    target: { base_url: "https://sandbox.local/", tool: "target_http" },
    emit_url: EMIT_URL,
    shared_memory_ref: `${RUN_ID}/memory`,
    intensity: "demo",
    shared_memory: shared,
  });
}

async function main(): Promise<void> {
  // recon first → seeds shared memory for the rest.
  const recon = buildMockOutput("recon", makeInput("recon", { components: [], notes: [] }));
  const shared = recon.findings;

  const rest = PERSONAS.filter((p) => p !== "recon").map((p) =>
    buildMockOutput(p, makeInput(p, shared)),
  );

  const outputs = [recon, ...rest];
  const allEvents = outputs.flatMap((o) => o.events);

  process.stdout.write(
    JSON.stringify({ run_id: RUN_ID, count: allEvents.length, events: allEvents }, null, 2) + "\n",
  );

  const weak = allEvents.filter((e) => e.event_type === "weakness_found");
  const crit = weak.filter((e) => e.severity === "critical");
  console.error(
    `\n[local-mock] ${outputs.length} personas · ${allEvents.length} events · ` +
      `${weak.length} weaknesses (${crit.length} critical)`,
  );

  if (POST) {
    console.error(`[local-mock] POSTing ${allEvents.length} events to ${EMIT_URL} ...`);
    const ok = await forwardEvents(EMIT_URL, allEvents);
    console.error(`[local-mock] forwarded ${ok}/${allEvents.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
