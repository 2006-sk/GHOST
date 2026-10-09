# LibreChat demo questions (demo beat #4)

Pick a Claude model, enable the **GHOST-ClickHouse** MCP server in the chat input,
then ask in plain English. The model writes and runs the SQL against ghost.events.

Rehearsed order for the stage:
1. **"How many attack events do we have, and what's our overall detection coverage?"**
   Expect ~1,000,000+ events, ~77% coverage.
2. **"Which attacks slipped through in run_demo? Break the misses down by technique."**
   Expect the `evasive:*` payload labels plus low-and-slow DoS on top.
3. **"Top 3 attack types by volume and our detection rate on each."**
   Expect dos, recon, netscan.
4. **"What's our median and p95 detection latency, by rule?"**
   Expect signature rules ~10ms, windowed rules ~80–100ms (measured query time over the full table).
5. **"Which source IPs did the most damage to the tower with attacks we missed?"**
   Uses `health_delta` on undetected `weakness_found` events.

Backup questions:
- "Show coverage % by severity. Are we catching the criticals?"
- "Which target component was attacked the most, and by which personas?"
- "How many events per second did we ingest in the busiest minute?"
