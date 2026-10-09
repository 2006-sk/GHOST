# GHOST — Coordinator (backend)

The one service everything plugs into. It ingests red-team agent events, owns
`seq` + `tower_health` + the detection verdict, writes to ClickHouse, and
broadcasts to the siege frontend over WebSocket. Runs on Shresth's laptop as the
demo machine. See `../docs/master.md` §4 for the canonical contract.

## Quick start (MOCK, zero external deps)

```bash
cd backend
npm install
MOCK=true npm start          # :8080, in-memory stats (no ClickHouse needed)

# in another terminal — kick a scripted siege:
bash scripts/seed-run.sh     # prepare → reset → run → trigger critical → state
```

Open a WebSocket to `ws://localhost:8080/ws` and you'll get a `snapshot`
immediately, then a stream of `event`, `detection`, and `stats` messages.

Smoke-test without the frontend:

```bash
npx wscat -c ws://localhost:8080/ws        # or: websocat ws://localhost:8080/ws
```

## What it does (maps to master.md §4)

| Responsibility | Where |
|---|---|
| Ingest `POST /events`, validate (§4.4) | `src/ingest.js`, `src/contract.js` |
| Assign `seq`, derive `health_delta` (§4.2), update `tower_health` (§4.8) | `src/health.js` |
| Detection verdict (inline in mock) | `src/detect.js` |
| Persist `INSERT … FORMAT JSONEachRow`, batched | `src/clickhouse.js` |
| Broadcast `snapshot`/`event`/`detection`/`stats` (§4.5) | `src/ws.js` |
| HTTP triggers (§4.6) | `src/triggers.js` |
| Start 6 Guild sessions (§4.7) or the mock loop (§5) | `src/orchestrator.js`, `src/mock-loop.js` |
| Small mutable state (runs/agents) | `src/postgres.js` (optional) |

## HTTP endpoints (§4.6)

| method + path | does |
|---|---|
| `POST /events` | agent event ingest (§4.4) |
| `POST /api/prepare` `{folder}` | boot/confirm the target sandbox |
| `GET /api/status` | `{ phase, ready, mode, run_id }` |
| `POST /api/run` `{run_id?}` | start the siege (Guild sessions or mock loop) |
| `POST /api/stop` | stop the mock loop |
| `GET /trigger/critical` | inject one detected critical (money shot) |
| `GET /reset` | reset `tower_health` to 100 |
| `GET /state` | full snapshot (health, stats, ws clients) |
| `GET /health` | liveness + which backends are wired |

WebSocket is at **`/ws`** (`ws://localhost:8080/ws`).

## The MOCK switch (§5)

- `MOCK=true` (default, what runs on stage): agents scripted via `mock-loop.js`,
  detection computed inline, each `event` already carries final `tower_health`.
  ClickHouse/Postgres/Guild are all optional — unset env = graceful in-memory
  fallback.
- `MOCK=false`: starts Guild sessions that hit the tunneled target; needs
  `PUBLIC_URL`, `GUILD_API_KEY`, and `ANTHROPIC_API_KEY`. Verdicts may lag, so we
  apply provisional damage and correct on the verdict.

## With ClickHouse

```bash
docker compose -f backend/docker-compose.yml up -d     # local CH on :8123
# Aditya: apply schema.sql, run the replayer to preload >=1M rows
CLICKHOUSE_URL=http://localhost:8123 MOCK=true npm start
```

When `CLICKHOUSE_URL` is set, inserts go to `ghost.events` (batched ~500 rows /
200 ms) and `stats` come from Aditya's `stats.sql`. Confirm the exact insert URL
and `stats.sql` output shape at checkpoint 1.

## Checkpoint-1 confirmations

- **Aditya:** ClickHouse insert URL + `INSERT … FORMAT JSONEachRow` example +
  `stats.sql` output shape.
- **Kenil:** push vs pull for agent events + the `emit`/`target_http` tool
  contract (built for **push** — agents POST to `/events`).
- **Aarsh:** live WS endpoint is `/ws`; `detection` is a separate message matched
  to its `event` by `seq`.
