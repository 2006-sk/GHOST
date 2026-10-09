-- netscan_portsweep — windowed rule (port sweep).
-- Buckets netscan events per (src_ip, 10-second window); a bucket with >= 10 distinct ports is an attack,
-- and every event in it is flagged. Runs over the whole run, history included.
SELECT seq, 'netscan_portsweep' AS rule
FROM ghost.events
WHERE run_id = {run:String}
  AND agent_persona = 'netscan'
  AND (src_ip, toStartOfInterval(ts, INTERVAL 10 SECOND)) IN
  (
      SELECT src_ip, toStartOfInterval(ts, INTERVAL 10 SECOND) AS bucket
      FROM ghost.events
      WHERE run_id = {run:String} AND agent_persona = 'netscan'
      GROUP BY src_ip, bucket
      HAVING uniqExact(target_component) >= 10
  )
