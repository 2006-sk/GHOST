// postgres.js — small mutable state (runs / agents / targets / rules).
// Never a no-op: defaults to an EMBEDDED, file-backed Postgres (PGlite) that
// runs in-process (no server, no Docker), so run-state always persists. If
// POSTGRES_URL is set, it uses a real remote Postgres via `pg` instead
// (e.g. the Postgres service on ClickHouse Cloud, per aditya.md §4).

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PG_URL = process.env.POSTGRES_URL || '';
const here = dirname(fileURLToPath(import.meta.url));           // backend/src
const DATA_DIR = join(here, '..', '.pgdata');                   // embedded store (gitignored)
const SCHEMA_PATHS = [
  join(here, '..', '..', 'data', 'postgres', 'schema.sql'),     // repo data/postgres/schema.sql
];

export const pgEnabled = true; // always on now (embedded by default)
export const pgMode = PG_URL ? 'remote' : 'embedded';

let dbp = null; // Promise<{ query(sql, params) }>

function schemaSql() {
  for (const p of SCHEMA_PATHS) if (existsSync(p)) return readFileSync(p, 'utf8');
  // inline fallback if the repo file isn't present
  return `
    CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY, started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ, mode TEXT, final_coverage NUMERIC);
    CREATE TABLE IF NOT EXISTS agents (run_id TEXT, agent_id TEXT, persona TEXT, state TEXT, updated_at TIMESTAMPTZ, PRIMARY KEY (run_id, agent_id));
    CREATE TABLE IF NOT EXISTS targets (id TEXT PRIMARY KEY, name TEXT, sandbox_id TEXT, status TEXT);
    CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, descr TEXT, threshold INT, enabled BOOLEAN DEFAULT TRUE);`;
}

async function init() {
  if (PG_URL) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: PG_URL });
    await pool.query(schemaSql());
    console.log('[postgres] connected (remote) + schema applied');
    return { query: (sql, params = []) => pool.query(sql, params), _pool: pool };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const db = await PGlite.create(DATA_DIR); // file-backed, persists across restarts
  await db.exec(schemaSql());
  console.log(`[postgres] embedded PGlite ready at ${DATA_DIR} + schema applied`);
  return { query: (sql, params = []) => db.query(sql, params), _db: db };
}

function getDb() {
  if (!dbp) dbp = init().catch((err) => { console.error('[postgres] init failed:', err.message); return null; });
  return dbp;
}

async function run(sql, params = []) {
  const db = await getDb();
  if (!db) return null;
  try { return await db.query(sql, params); }
  catch (err) { console.error('[postgres] query error:', err.message); return null; }
}

export async function recordRunStart(run_id, mode) {
  await run(
    `INSERT INTO runs (run_id, started_at, mode) VALUES ($1, now(), $2)
     ON CONFLICT (run_id) DO UPDATE SET started_at = now(), mode = $2`,
    [run_id, mode]
  );
}

export async function recordRunEnd(run_id, final_coverage) {
  await run(`UPDATE runs SET ended_at = now(), final_coverage = $2 WHERE run_id = $1`,
    [run_id, final_coverage ?? null]);
}

export async function setAgentState(run_id, agent_id, state, persona = null) {
  await run(
    `INSERT INTO agents (run_id, agent_id, persona, state, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (run_id, agent_id) DO UPDATE SET state = $4, persona = COALESCE($3, agents.persona), updated_at = now()`,
    [run_id, agent_id, persona, state]
  );
}

// Read helpers (for /api/runs and debugging).
export async function listRuns(limit = 20) {
  const r = await run(`SELECT * FROM runs ORDER BY started_at DESC NULLS LAST LIMIT $1`, [limit]);
  return r ? r.rows : [];
}
export async function listAgentsForRun(run_id) {
  const r = await run(`SELECT agent_id, persona, state, updated_at FROM agents WHERE run_id = $1 ORDER BY agent_id`, [run_id]);
  return r ? r.rows : [];
}

export async function shutdownPostgres() {
  const db = await getDb().catch(() => null);
  if (db?._pool) await db._pool.end().catch(() => {});
  if (db?._db?.close) await db._db.close().catch(() => {});
}
