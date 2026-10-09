// postgres.js — small mutable state (runs/agents). Stretch; never blocks the loop.
// Degrades to no-op if POSTGRES_URL is unset. Uses a lazy dynamic import of `pg`
// so the dependency is optional for the core demo.

const PG_URL = process.env.POSTGRES_URL || '';
export const pgEnabled = Boolean(PG_URL);

let pool = null;

async function getPool() {
  if (!pgEnabled) return null;
  if (pool) return pool;
  try {
    const { default: pg } = await import('pg');
    pool = new pg.Pool({ connectionString: PG_URL });
    return pool;
  } catch (err) {
    console.warn('[postgres] `pg` not installed or connect failed; skipping', err.message);
    return null;
  }
}

async function run(sql, params = []) {
  const p = await getPool();
  if (!p) return null;
  try {
    return await p.query(sql, params);
  } catch (err) {
    console.error('[postgres] query error', err.message);
    return null;
  }
}

export async function recordRunStart(run_id, mode) {
  await run(
    `INSERT INTO runs (run_id, started_at, mode)
     VALUES ($1, now(), $2)
     ON CONFLICT (run_id) DO UPDATE SET started_at = now(), mode = $2`,
    [run_id, mode]
  );
}

export async function recordRunEnd(run_id, final_coverage) {
  await run(
    `UPDATE runs SET ended_at = now(), final_coverage = $2 WHERE run_id = $1`,
    [run_id, final_coverage]
  );
}

export async function setAgentState(run_id, agent_id, state) {
  await run(
    `INSERT INTO agents (run_id, agent_id, state, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (run_id, agent_id) DO UPDATE SET state = $3, updated_at = now()`,
    [run_id, agent_id, state]
  );
}

export async function shutdownPostgres() {
  if (pool) await pool.end();
}
