-- logic_anomaly — per-event signature rule (negative qty, coupon stacking).
-- Flags logic_abuse events whose payload carries a known signature label.
SELECT seq, 'logic_anomaly' AS rule
FROM ghost.events
WHERE run_id = {run:String}
  AND agent_persona = 'logic_abuse'
  AND startsWith(payload, 'sig:')
