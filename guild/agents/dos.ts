"use agent";
// agents/dos.ts — agent-5 · persona "dos"
// NOTE: emits resilience FINDINGS as labeled events only. There is no traffic
// generator / flooding engine anywhere in this agent or repo.
import {
  agent,
  noTools,
  type Task,
  progressLogNotifyEvent,
} from "@guildai/agents-sdk";
import {
  sessionInputSchema,
  eventsOutputSchema,
  type SessionInput,
  type EventsOutput,
} from "../schema/session-input";
import { buildMockOutput } from "./mock-run";
import { AGENT_ID } from "./base";

const PERSONA = "dos" as const;
type Tools = typeof noTools;

async function run(input: SessionInput, task: Task<Tools>): Promise<EventsOutput> {
  await task.ui?.notify(
    progressLogNotifyEvent(`[${AGENT_ID[PERSONA]}] ${PERSONA} wave starting (mode=${input.mode})`),
  );
  if (input.mode === "real") {
    // A real load/flooding engine is deliberately NOT built here.
    throw new Error("GHOST: real mode not implemented in this build (defensive/MOCK scope)");
  }
  return buildMockOutput(PERSONA, input);
}

export default agent({
  inputSchema: sessionInputSchema,
  outputSchema: eventsOutputSchema,
  tools: noTools,
  run,
});
