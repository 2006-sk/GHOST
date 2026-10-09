# /data — ClickHouse detection brain (Aditya)

Append-only attack telemetry in ClickHouse Cloud (`ghost.events`), detection as
analytical SQL over the whole stream, and the live HUD stats.

## Layout
```
ch.py                       stdlib ClickHouse HTTP client (reads repo-root .env)
detect.py                   run all rules over a run: flagged / agreement / exec ms
clickhouse/schema.sql       ghost.events — columns match backend/src/ingest.js row
clickhouse/stats.sql        §4.5 `stats` message, one JSON row
clickhouse/detection/*.sql  6 rules, each returns (seq, rule) for {run:String}
replayer/generate.py        synthetic campaigns, verdicts computed exactly like the SQL
replayer/load.py            gzip JSONEachRow bulk insert, parallel batches
```

## For Shresth (coordinator)
- **Insert URL:** `CLICKHOUSE_URL=https://ar2xp68m2g.eastus2.azure.clickhouse.cloud:8443`,
  user `default`, password sent privately. `ghost.events` already exists.
- **Insert:** your current `INSERT INTO ghost.events FORMAT JSONEachRow` rows from
  `ingest.js` load as-is (nulls, JSON booleans, ISO `...Z` timestamps all verified).
  ```bash
  curl -u default:$CLICKHOUSE_PASSWORD "$CLICKHOUSE_URL" --data-binary $'INSERT INTO ghost.events FORMAT JSONEachRow\n{"run_id":"run_x","seq":1,"event_type":"weakness_found","agent_id":"agent-3","agent_persona":"injection","severity":"critical","description":"...","detected":true,"rule":"sqli_signature","detect_latency_ms":7,"ts":"2026-10-09T18:22:01.123Z"}'
  ```
- **Stats — please switch to `clickhouse/stats.sql`.** The query in
  `backend/src/clickhouse.js` errors on ClickHouse (`countIf(detected) AS detected`
  shadows the column, so `countIf(NOT detected)` fails) and `getStats` silently
  falls back to the in-memory tally. `stats.sql` returns the full §4.5 shape,
  including `by_persona` / `by_severity`, from ClickHouse:
  ```
  POST $CLICKHOUSE_URL/?param_run=<run_id>   body = stats.sql
  -> {"total_events":1000000,"detected":770418,"missed":229582,"coverage_pct":77,
      "mttd_ms":92.4,"by_persona":{"injection":{"events":89255,"detected":75929},...},
      "by_severity":{"critical":...,"high":...}}
  ```
  Just add `kind` and `run_id` and broadcast it.
- **Run id:** 1M historical rows are loaded under `run_demo`. Start the coordinator
  with `RUN_ID=run_demo` so live events land on top of the pile and the HUD shows
  the real total. Historical seqs start at 1,000,000,000, so they never collide
  with your live seq counter.

## Commands
```bash
python replayer/load.py --run-id run_demo --rows 1000000 --replace   # ~30s
python detect.py --run-id run_demo --write-latency                   # rules + timings
```

## Numbers (1M rows, ClickHouse Cloud, warm)
| rule | kind | exec ms |
|---|---|---|
| sqli_signature, auth_bypass, logic_anomaly | per-event signature | 9–13 |
| dos_flood, recon_sweep, netscan_portsweep | windowed (src_ip × 1s/10s buckets) | 85–97 |
| stats.sql | full HUD stats | ~48 |

`mttd_ms` = mean of `detect_latency_ms` over detected events; for the historical
pile that is each rule's measured execution time over the full table (set by
`detect.py --write-latency`), not a per-event lookup time.

Payloads in the synthetic data are labels (`sig:sqli_union`, `evasive:jwt_weak_secret`,
`flood:request`, `probe:recon`), not real attack strings.
