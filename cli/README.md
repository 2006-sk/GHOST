# `ghost` — CLI launcher

The terminal entry point for a GHOST siege. `cd` into any repo, run `ghost run`,
and it triggers a live siege against that code (via the already-running
coordinator) and opens the dashboard. This is the demo opener — stronger than
drag-and-drop.

It's a **thin client** over the coordinator HTTP API (master.md §4.6) — no new
server-side plumbing. Everything runs locally; the CLI does **not** upload code,
it just reads light folder metadata and triggers the coordinator.

## Install

```bash
cd cli
npm install
npm link            # gives you a global `ghost`
# (or run without linking: node bin/ghost.js run)
```

Needs the coordinator running first:

```bash
cd ../backend && MOCK=true npm start      # :8080
```

## Commands

```bash
ghost run [path]            # default: cwd. Launch a siege + open the dashboard.
  --mock / --real           # override mode (default: coordinator's env)
  --coordinator <url>       # default http://localhost:8080  (env COORDINATOR_URL)
  --dashboard  <url>        # default http://localhost:5173   (env DASHBOARD_URL)
  --no-open                 # don't launch the browser (for recording control)
  --run-id <id>             # name the run (else coordinator generates)

ghost watch <run_id>        # attach to a running/finished siege, stream lines
ghost status [run_id]       # one-shot coverage/health/events, then exit
```

## What `ghost run` does

```
  ▸ GHOST  target: vulnerable-bank (142 files)
  · detected endpoints: /api/search, /api/checkout, /api/login
  ▸ connecting to coordinator… ✓  (http://localhost:8080)
  ▸ preparing sandbox… ✓
  ▸ launching 6 agents… ✓  run_id: run_20261009_07
  ▸ dashboard → http://localhost:5173/?run=run_20261009_07  (opening…)
  ▸ siege live — watching. ctrl-c to detach ✓
     18:22:01  agent-3  injection   /api/search    weakness  CRITICAL  ✗ MISSED
     18:22:02  agent-4  auth_bypass /api/export     blocked   HIGH      ✓ 6ms
  └ coverage 92.4%   mttd 6.8ms   detected 1,181,000 / 1,250,412
```

Steps map 1:1 to the coordinator endpoints: `GET /health` → `POST /api/prepare`
→ poll `GET /api/status` → `POST /api/run` (returns `run_id`) → WS `/ws` stream.

## Env

Add to the shared `.env` (see `../backend/.env.example`):

```bash
COORDINATOR_URL=http://localhost:8080
DASHBOARD_URL=http://localhost:5173
```

## Frontend note (Aarsh)

The dashboard is opened at `DASHBOARD_URL/?run=<run_id>`. The frontend should read
`?run` and subscribe to that run's WS stream (it already keys messages on
`run_id`). No other change needed.
