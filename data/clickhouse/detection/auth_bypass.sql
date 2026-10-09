-- auth_bypass — per-event signature rule (unsigned JWT, IDOR, role escalation).
-- Flags auth_bypass events whose payload carries a known signature label.
SELECT seq, 'auth_bypass' AS rule
FROM ghost.events
WHERE run_id = {run:String}
  AND agent_persona = 'auth_bypass'
  AND startsWith(payload, 'sig:')
