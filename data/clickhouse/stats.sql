-- GHOST — live HUD stats for one run (master.md §4.5 `stats` message).
-- One row, JSONEachRow, field names match the WS message exactly:
--   {"total_events":N,"detected":N,"missed":N,"coverage_pct":F,"mttd_ms":F,
--    "by_persona":{"injection":{"events":N,"detected":N},...},
--    "by_severity":{"critical":N,...}}
-- Call:  POST $CLICKHOUSE_URL/?param_run=<run_id>   body = this file
-- Inner aliases (det, mttd) deliberately differ from column names: aliasing
-- countIf(detected) AS detected shadows the column and breaks later references.

SELECT
    t.total_events                                            AS total_events,
    t.det                                                     AS detected,
    t.total_events - t.det                                    AS missed,
    if(t.total_events = 0, 0, round(100 * t.det / t.total_events, 1)) AS coverage_pct,
    round(ifNotFinite(t.mttd, 0), 1)                          AS mttd_ms,
    p.m                                                       AS by_persona,
    s.m                                                       AS by_severity
FROM
(
    SELECT count() AS total_events,
           countIf(detected) AS det,
           avgIf(detect_latency_ms, detected) AS mttd
    FROM ghost.events
    WHERE run_id = {run:String}
) AS t
CROSS JOIN
(
    SELECT mapFromArrays(groupArray(agent_persona),
                         groupArray(map('events', n, 'detected', d))) AS m
    FROM
    (
        SELECT agent_persona, count() AS n, countIf(detected) AS d
        FROM ghost.events
        WHERE run_id = {run:String}
        GROUP BY agent_persona
    )
) AS p
CROSS JOIN
(
    SELECT mapFromArrays(groupArray(severity), groupArray(n)) AS m
    FROM
    (
        SELECT severity, count() AS n
        FROM ghost.events
        WHERE run_id = {run:String} AND severity != ''
        GROUP BY severity
    )
) AS s
FORMAT JSONEachRow
SETTINGS output_format_json_quote_64bit_integers = 0
