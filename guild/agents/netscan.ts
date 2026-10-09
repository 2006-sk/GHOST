"use agent";
// agents/netscan.ts — agent-2 · persona "netscan"
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

const PERSONA = "netscan" as const;
type Tools = typeof noTools;

async function run(input: SessionInput, task: Task<Tools>): Promise<EventsOutput> {
  await task.ui?.notify(
    progressLogNotifyEvent(`[${AGENT_ID[PERSONA]}] ${PERSONA} wave starting (mode=${input.mode})`),
  );
  if (input.mode === "real") {
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
