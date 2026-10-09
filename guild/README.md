# GHOST — Guild Agents (`/guild`)

Six scripted red-team **personas** that emit the canonical event stream
(`master.md` §4.4) into GHOST's detection pipeline. This is **attack
simulation for detection validation**: in MOCK mode the agents produce labeled
events (detection signatures) so the defensive side — ClickHouse scoring, the
siege HUD, LibreChat — can prove it catches every hit. **No exploit is executed
against any target by this code.**

Owner: Kenil · Branch: `kenil/guild-agents` · Contract: `master.md` §4 (§4.7 owned here).

---

## What's here

```
guild/
  agents/
    base.ts          # SDK-free core: event builders + scripted MOCK wave runner
    mock-run.ts      # persona → EventsOutput (drives both Guild run() and local-mock)
    recon.ts         # agent-1  ┐
    netscan.ts       # agent-2  │ six Guild agent entrypoints
    injection.ts     # agent-3  │ agent({inputSchema, outputSchema, tools, run})
    auth_bypass.ts   # agent-4  │ + "use agent"
    dos.ts           # agent-5  │
    logic_abuse.ts   # agent-6  ┘
  playbooks/*.ts     # scripted technique LABELS per persona (MOCK data)
  schema/
    event.ts         # zod: canonical event (§4.4)
    session-input.ts # zod: session input (§4.7) + agent output
  orchestration/
    forward-events.ts# POST events → coordinator /events (runs OUTSIDE sandbox)
    local-mock.ts    # full six-persona MOCK stream with NO Guild (fallback demo)
  session-input.schema.json  # JSON-Schema mirror of §4.7
  deploy.sh          # publish all six to the Guild workspace
```

---

## Two SDK realities that shaped this (read before changing anything)

The Guild Agent SDK docs (docs.guild.ai) differ from the first-draft plan:

1. **The API is `agent({ inputSchema, outputSchema, tools, run })` with a
   `"use agent"` directive** (the Babel compiler turns `run` into a resumable
   state machine), plus `llmAgent` for prompt-driven agents. Input/output are
   zod `z.object()` at the root. There is no `AutomaticallyManagedStateAgent`
   class to instantiate.

2. **Outbound HTTP is blocked — even inside a custom tool.** Quote:
   *"Agents have no direct route to the internet, so fetch, axios, and
   node:http do not work — including inside a custom tool."* Integrations
   (e.g. `guildai~experimental-fetch`) are the only way out, and there is no
   runtime filesystem access either.

### Consequence: pull model, not an `emit` tool  ⚠️ confirm with Shresth

Because a custom `emit` tool **cannot POST**, each agent instead **returns** its
events as typed output (`EventsOutput`), and `orchestration/forward-events.ts`
— running in the orchestrator, **outside** the sandbox — POSTs each event,
**unchanged**, to the coordinator `/events`.

> The forwarder sends the exact §4.4 JSON to the exact `/events` endpoint, so
> **the coordinator sees no change** — only the transport moved. This is the
> "pull vs push" checkpoint-1 decision from `kenil.md`; the SDK forces pull.
> Blast radius on Shresth's side: zero. Please confirm anyway.

Also because there's no runtime filesystem, playbooks are **TS modules**
(imported at build time), not `.json` files read at runtime.

---

## Run it

### Local MOCK (no Guild needed) — the reliable demo path
```bash
cd guild
npm install
npm run mock          # prints the merged six-persona event stream (JSON)
npm run mock:post     # also POSTs every event to $EMIT_URL (default :8080/events)
```
`local-mock.ts` reproduces the whole stream with **no Guild dependency**, so the
detection loop + siege can run even if Guild wobbles (`master.md` §8).
Deterministic per `RUN_ID` (seeded RNG), so the stage demo replays identically.

Env: `RUN_ID` (default `run_local_01`), `EMIT_URL` (default
`http://localhost:8080/events`).

### Typecheck
```bash
npm run typecheck          # SDK-free core (verifiable without the Guild SDK)
npm i -D @guildai/agents-sdk && npm run typecheck:agents   # the six entrypoints
```

### Deploy to Guild
```bash
export GUILD_WORKSPACE=owner~your-workspace
bash deploy.sh
```
See `deploy.sh` for the per-agent layout caveat (confirm against
`guild agent init`). Screenshot the Guild sessions dashboard for submission.

---

## Event contract (what every agent emits — `master.md` §4.4)

- `attack_started` → then one of `weakness_found` (has `severity` + `description`)
  or `attack_result` (held, no weakness).
- Agents **never** send `health_delta`, `seq`, or `tower_health` — the
  coordinator owns those.
- `agent_id` ↔ `persona` is fixed (§4.1): recon=agent-1 … logic_abuse=agent-6.
- In MOCK, `payload` / `http_status` / `evidence` / `src_ip` are **synthesized
  labels**, not captured from a live target.

---

## Scope: what is intentionally NOT built (and why)

This build is defensive — attack **simulation** for detection validation. The
following are deliberately absent because MOCK mode (the stage demo and the core
of the definition-of-done) does not need them, and they would be live offensive
tooling:

- **Real mode (LLM-driven live exploitation).** Each agent's `run()` throws on
  `mode: "real"`. The autonomous "pick a payload, hit the target, read the
  response, adapt" loop is not implemented.
- **`target_http` attack-delivery tool.** Not implemented. (The target's
  `base_url` is accepted in the input for contract-completeness only.)
- **A DoS traffic/flooding engine.** The `dos` persona emits resilience
  *findings* as labels; it generates no load.

If the team later wants a genuine real-mode proof against the **sandboxed,
team-owned** `TowerBank` target, treat that as a separate, scoped task with
explicit sign-off — it is not part of this folder.

---

## Definition of done (`kenil.md`) — status

- [x] Six agents, one per persona, ids `agent-1..6` mapped correctly (§4.1).
- [x] MOCK mode: each emits a valid `attack_started → weakness_found/attack_result` stream.
- [x] Recon seeds shared memory (routes/notes) the others read.
- [x] Events validate against §4.4 (zod schema in `schema/event.ts`; mirrored JSON-Schema).
- [x] `session-input.schema.json` written (§4.7).
- [x] `deploy.sh` publishes all six.
- [ ] Guild sessions dashboard screenshot (run `deploy.sh`, then capture).
- [ ] Real-mode `injection` proof — **out of scope for this build** (see above).
```
