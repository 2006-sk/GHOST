-- sqli_signature — per-event signature rule (SQLi / XSS / prompt injection).
-- Flags injection events whose payload carries a known signature label.
SELECT seq, 'sqli_signature' AS rule
FROM ghost.events
WHERE run_id = {run:String}
  AND agent_persona = 'injection'
  AND startsWith(payload, 'sig:')
