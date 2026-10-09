-- recon_sweep — windowed rule (route crawl).
-- Buckets recon events per (src_ip, 10-second window); a bucket with >= 8 distinct paths is an attack,
-- and every event in it is flagged. Runs over the whole run, history included.
SELECT seq, 'recon_sweep' AS rule
FROM ghost.events
WHERE run_id = {run:String}
  AND agent_persona = 'recon'
  AND (src_ip, toStartOfInterval(ts, INTERVAL 10 SECOND)) IN
  (
      SELECT src_ip, toStartOfInterval(ts, INTERVAL 10 SECOND) AS bucket
      FROM ghost.events
      WHERE run_id = {run:String} AND agent_persona = 'recon'
      GROUP BY src_ip, bucket
      HAVING uniqExact(target_component) >= 8
  )
