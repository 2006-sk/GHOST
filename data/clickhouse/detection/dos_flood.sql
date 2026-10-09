-- dos_flood — windowed rule (request flood).
-- Buckets dos events per (src_ip, 1-second window); a bucket with >= 50 requests is an attack,
-- and every event in it is flagged. Runs over the whole run, history included.
SELECT seq, 'dos_flood' AS rule
FROM ghost.events
WHERE run_id = {run:String}
  AND agent_persona = 'dos'
  AND (src_ip, toStartOfInterval(ts, INTERVAL 1 SECOND)) IN
  (
      SELECT src_ip, toStartOfInterval(ts, INTERVAL 1 SECOND) AS bucket
      FROM ghost.events
      WHERE run_id = {run:String} AND agent_persona = 'dos'
      GROUP BY src_ip, bucket
      HAVING count() >= 50
  )
