# Handoff for Shresth: ClickHouse is live

From Aditya. ClickHouse Cloud is up, `ghost.events` exists, and it already holds
**1,000,000 historical attack events** under `run_demo`. Three steps: connect,
swap one function, run on `run_demo`. About 10 minutes.

## 1. Connect (`.env`)
I'll send the URL and password privately. Put them in the coordinator's `.env`:
```bash
CLICKHOUSE_URL=https://<host>.clickhouse.cloud:8443
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=<sent privately>
CLICKHOUSE_DATABASE=ghost
RUN_ID=run_demo
```
**`RUN_ID=run_demo` matters:** live siege events land on top of the 1M-row pile,
so the HUD shows `total_events` = 1,000,000+ instead of a few hundred. Historical
`seq`s start at 1,000,000,000, so they never collide with your live counter.

Smoke test (should print `1000000`):
```bash
curl -s -u "default:$CLICKHOUSE_PASSWORD" "$CLICKHOUSE_URL"   --data-binary "SELECT count() FROM ghost.events WHERE run_id = 'run_demo'"
```

## 2. Inserts: no change needed
Your `insertEvent` rows from `ingest.js` load as they are. I tested nulls, JSON
booleans, and ISO `...Z` timestamps against the real table.

## 3. Stats: replace `statsFromClickHouse` in `backend/src/clickhouse.js` (required)
Your current query **errors on ClickHouse**: `countIf(detected) AS detected`
shadows the `detected` column, so `countIf(NOT detected)` fails. `getStats` then
silently falls back to the in-memory tally, which means the HUD isn't really
reading ClickHouse. Replace the whole `statsFromClickHouse` function with this
(tested against Cloud; it also returns `by_persona` / `by_severity` from
ClickHouse, so the local-tally merge goes away):

```js
// Same SQL as data/clickhouse/stats.sql. Inner aliases (det, mttd) must differ
// from column names, or `AS detected` shadows the column and the query fails.
const STATS_SQL = `
SELECT
    t.total_events AS total_events,
    t.det AS detected,
    t.total_events - t.det AS missed,
    if(t.total_events = 0, 0, round(100 * t.det / t.total_events, 1)) AS coverage_pct,
    round(ifNotFinite(t.mttd, 0), 1) AS mttd_ms,
    p.m AS by_persona,
    s.m AS by_severity
FROM
(
    SELECT count() AS total_events, countIf(detected) AS det, avgIf(detect_latency_ms, detected) AS mttd
    FROM ${CH_DB}.events WHERE run_id = {run:String}
) AS t
CROSS JOIN
(
    SELECT mapFromArrays(groupArray(agent_persona), groupArray(map('events', n, 'detected', d))) AS m
    FROM (SELECT agent_persona, count() AS n, countIf(detected) AS d
          FROM ${CH_DB}.events WHERE run_id = {run:String} GROUP BY agent_persona)
) AS p
CROSS JOIN
(
    SELECT mapFromArrays(groupArray(severity), groupArray(n)) AS m
    FROM (SELECT severity, count() AS n
          FROM ${CH_DB}.events WHERE run_id = {run:String} AND severity != '' GROUP BY severity)
) AS s
FORMAT JSONEachRow
SETTINGS output_format_json_quote_64bit_integers = 0`;

async function statsFromClickHouse(run_id) {
  try {
    const url = new URL(CH_URL);
    url.searchParams.set('param_run', run_id);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Authorization: 'Basic ' + Buffer.from(`${CH_USER}:${CH_PASSWORD}`).toString('base64'),
      },
      body: STATS_SQL,
    });
    if (!res.ok) {
      console.error('[clickhouse] stats failed', res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const row = JSON.parse((await res.text()).trim());
    return { kind: 'stats', run_id, ...row };
  } catch (err) {
    console.error('[clickhouse] stats error', err.message);
    return null;
  }
}
```
It returns the exact §4.5 `stats` message:
```json
{"kind":"stats","run_id":"run_demo","total_events":1000000,"detected":770418,"missed":229582,
 "coverage_pct":77,"mttd_ms":92.4,
 "by_persona":{"injection":{"events":89255,"detected":75929},"dos":{"events":573761,"detected":409037}},
 "by_severity":{"critical":74479,"high":143928,"medium":22518,"low":639229,"info":119846}}
```
The query takes about 50ms over 1M rows, so polling once a second is fine.

## 4. Test end to end
```bash
cd backend && MOCK=true RUN_ID=run_demo npm start
curl -X POST localhost:8080/api/run
# watch stats from ClickHouse (Node 22+ has a global WebSocket):
node -e "const w=new WebSocket('ws://localhost:8080/ws');w.onmessage=e=>{const m=JSON.parse(e.data);if(m.kind==='stats')console.log(m.total_events,m.coverage_pct+'%',m.mttd_ms+'ms')}"
```
Pass if:
- [ ] `total_events` starts at 1,000,000 and climbs as the siege runs
- [ ] no `[clickhouse] stats failed` / `insert failed` lines in the coordinator log
- [ ] live rows are in ClickHouse (count goes up):
  ```bash
  curl -s -u "default:$CLICKHOUSE_PASSWORD" "$CLICKHOUSE_URL"     --data-binary "SELECT count() FROM ghost.events WHERE run_id = 'run_demo' AND seq < 1000000000"
  ```

## 5. Optional: use the same rule names in `detect.js`
My six SQL rules are named `sqli_signature`, `auth_bypass`, `logic_anomaly`,
`dos_flood`, `recon_sweep`, `netscan_portsweep`. `detect.js` currently emits
`flood_rate_limit`, `crawl_anomaly`, `jwt_alg_none`, and so on. If live rows use
the same six names, LibreChat answers ("which rule caught the most?") stay
consistent, and on stage we can say "the same rules score history and the live
siege." Simplest change is to the `RULES` map:
```js
const RULES = {
  injection: () => 'sqli_signature',
  auth_bypass: () => 'auth_bypass',
  dos: () => 'dos_flood',
  netscan: () => 'netscan_portsweep',
  recon: () => 'recon_sweep',
  logic_abuse: () => 'logic_anomaly',
};
```

## Don'ts
- Don't run `data/replayer/load.py --replace` on `run_demo` near the demo; it
  drops the whole run, live rows included.
- Don't commit `.env` (it's already gitignored).

Questions: ask Aditya. Everything else on the ClickHouse side is in `data/README.md`.
