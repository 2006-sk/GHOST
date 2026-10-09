// orchestration/forward-events.ts
// Runs in the ORCHESTRATOR — plain Node, OUTSIDE the Guild sandbox.
//
// WHY THIS LIVES OUTSIDE THE SANDBOX: the Guild runtime blocks outbound HTTP,
// even inside a custom tool ("fetch, axios, and node:http do not work").
// So agents RETURN their events as typed output (pull model), and this
// forwarder POSTs each event, unchanged, to the coordinator /events — the
// exact §4.4 JSON the coordinator already expects. The wire contract does not
// change; only the transport moves out here.
import type { EventsOutput } from "../schema/session-input";
import type { GhostEvent } from "../agents/base";

export async function forwardEvents(emitUrl: string, events: GhostEvent[]): Promise<number> {
  let ok = 0;
  for (const ev of events) {
    try {
      const res = await fetch(emitUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ev),
      });
      if (res.ok) ok++;
      else console.error(`[forward] POST ${emitUrl} -> ${res.status}`);
    } catch (err) {
      console.error(`[forward] POST ${emitUrl} failed:`, err);
    }
  }
  return ok;
}

export async function forwardOutput(emitUrl: string, out: EventsOutput): Promise<number> {
  return forwardEvents(emitUrl, out.events);
}
