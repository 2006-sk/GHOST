# LibreChat demo questions (demo beat #4)

Open http://localhost:3080 and start a **New Chat**. The default **GHOST Analyst**
preset already selects Claude Sonnet 4.6 and enables the **GHOST-ClickHouse** MCP
server. Ask in plain English; the model writes and runs the SQL against
ghost.events. Each answer takes about 15–20 seconds. Click "Ran run_select_query"
to show judges the SQL.

## Rehearsed 2026-10-09: all 5 pass, in one conversation
| # | Ask | What came back |
|---|---|---|
| 1 | "How many attack events do we have, and what's our overall detection coverage?" | 1,000,000 events, 770,418 detected, **77.04%** coverage (matches stats.sql) |
| 2 | "Which attacks slipped through in run_demo? Break the misses down by technique." | 229,582 misses: flood 164,724 (71.7%), probe 35,952 (15.7%), evasive 28,906 (12.6%, the high/critical ones) |
| 3 | "Top 3 attack types by volume and our detection rate on each." | dos 573,761 @ 71.3%, recon 142,162 @ 86.3%, netscan 90,271 @ 81.7% |
| 4 | "What's our median and p95 detection latency, by rule?" | signature rules 8–11 ms, windowed 44–73 ms; correctly explains it is query time over the full ~1M-row run |
| 5 | "Which source IPs did the most damage to the tower with attacks we missed?" | top 10 IPs (mostly injection / auth_bypass), up to 195 damage each |

Best stage order: **2 → 5 → 4** (misses → who hurt us → how fast we catch the rest).

Backup questions:
- "Show coverage % by severity. Are we catching the criticals?"
- "Which target component was attacked the most, and by which personas?"
- "How many events per second did we ingest in the busiest minute?"

## Gotchas
- **Use the GHOST Analyst preset, not Claude 5.x.** Sonnet/Opus/Haiku 5.x always send
  thinking blocks between tool calls, and LibreChat 0.8.7 mangles them on the next turn
  (`400 ... thinking.thinking: Field required`). The preset uses claude-sonnet-4-6 with
  thinking off, which works for multi-turn tool use.
- If an answer errors mid-demo, click **New Chat** and re-ask; nothing is lost.
- Local login: `LIBRECHAT_DEMO_EMAIL` / `LIBRECHAT_DEMO_PASSWORD` in `data/librechat/.env`.
