# GHOST — Frontend (the 3D siege, defensive)

The showstopper. Six autonomous red-team agents lay siege to a white wireframe
tower; GHOST proves live that each hit is **detected and intercepted by a
shield**, or scores the ones that **slip through and do damage**. The HUD shows
**coverage %** and **detection latency** straight from the Coordinator (backed by
ClickHouse). Vite + Three.js, vanilla JS, no framework.

Reskinned from the Tower Siege engine (`redteam@integration/frontend`) to the
GHOST contract in `../docs/master.md` §4.

## Run

```bash
npm install
npm run dev     # mock Coordinator on :8080 (/ws) + Vite on :5173
```

Open **http://localhost:5173** and click **Use demo target**, or go straight to a
zero-backend rehearsal:

- **http://localhost:5173/?demo** — built-in simulator, no backend needed.
- **http://localhost:5173/?demo&critical** — same, and auto-fires the money shot.

Against the **real** Coordinator, run it on :8080 instead of `npm run mock` (or
point the app elsewhere with `VITE_WS_URL` / `VITE_API_BASE`, or `?ws=` / `?api=`).

### Scripts
| script | does |
|---|---|
| `npm run dev` | mock Coordinator + web, together (solo frontend dev) |
| `npm run web` | Vite only (talks to whatever Coordinator is on :8080) |
| `npm run mock` | the bundled GHOST-contract mock Coordinator only |
| `npm run build` | production build to `dist/` |

## The two lanes (master.md §4.8)

Every attack travels two ways at once:

- **Visual lane** (`event`) — a jet lunges at the tower **immediately**. Never
  waits on the database. `tower_health` on the event is authoritative.
- **Analytics lane** (`detection`, matched by `seq`) — arrives ms later:
  - `detected: true` → **shield intercept**: a cool dome ripple at the impact
    point, no fracture.
  - `detected: false` → the hit **lands**: outward shockwave + fracture + damage.

Each strike's impact point is remembered by `seq`, so the shield-or-damage effect
lands exactly where the jet hit, whenever the verdict shows up.

## WebSocket it consumes (master.md §4.5)
`snapshot` · `event` · `detection` · `stats` — routed in `src/net/wsClient.js`,
wired in `src/main.js`. `snapshot.mode` drives the **MOCK** vs **LIVE** badge.

## HTTP it sends (master.md §4.6)
Folder-select → loading → siege calls `POST /api/prepare`, `GET /api/status`,
`POST /api/run`. **C** → `GET /trigger/critical`, **R** → `GET /reset`. If the
backend is down, it falls back to the local simulator so a recording never stalls.

## Controls
**C** fire critical (money shot) · **S** toggle simulator · **R** reset ·
**T** / `1`–`6` swap target shape · **H** hide HUD (clean screenshot) · drag to orbit.

## Design
Monochrome white-on-black line art with two restrained accents — **cool =
intercepted / shield held**, **warm = missed / damage got through** — always
paired with a ✓ / ✗ glyph and a label, never color alone. Severity reads through
brightness, weight, and motion.

## Files
| path | role |
|---|---|
| `src/config.js` | WS/API URLs, 6-agent roster, severity map |
| `src/net/wsClient.js` | socket client; routes the 4 message kinds |
| `src/net/simulator.js` | zero-backend event+detection+stats source |
| `src/main.js` | two-lane dispatch; shield-vs-damage matched by `seq` |
| `src/scene/tower.js` | wireframe target + shield dome + `shieldPulse` |
| `src/scene/swarm.js` | 6 jets, one per agent, orbit/dive/strike state machine |
| `src/scene/effects.js` | outward shockwave (damage) + inward `shieldHit` (blocked) |
| `src/ui/hud.js` | roster, integrity, coverage/latency tiles, detection feed, charts |
| `mock-server/server.mjs` | GHOST-contract mock Coordinator for solo dev |
