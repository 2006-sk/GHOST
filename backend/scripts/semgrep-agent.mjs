// semgrep-agent.mjs — the SEMGREP agent (agent-7, persona "semgrep").
// Runs Semgrep over the target's SOURCE and emits each finding as a §4.4 event
// to the coordinator, so static analysis shows up as its own agent in the siege
// (chip, decision log, weakness feed, report card) alongside the live red-team.
//
//   node scripts/semgrep-agent.mjs
// Env: RUN_ID, EMIT_URL (default :8080/events), TARGET_DIR (default ../attacky),
//      SEMGREP_BIN (default: semgrep on PATH or ~/.local/bin/semgrep)
import './../src/env.js';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const RUN_ID = process.env.RUN_ID || `run_sast_${Date.now()}`;
const EMIT_URL = process.env.EMIT_URL || 'http://localhost:8080/events';
const TARGET_DIR = process.env.TARGET_DIR || join(here, '..', '..', 'attacky');
const RULES = join(here, '..', '..', 'data', 'semgrep', 'ghost-rules.yml');
const SEMGREP = process.env.SEMGREP_BIN ||
  [join(process.env.HOME || '', '.local/bin/semgrep'), '/opt/anaconda3/bin/semgrep', 'semgrep']
    .find((p) => p === 'semgrep' || existsSync(p)) || 'semgrep';

const nowIso = () => new Date().toISOString();
const AGENT_ID = 'agent-7';
const PERSONA = 'semgrep';

// semgrep severity + rule → GHOST severity
function sevOf(f) {
  const id = (f.check_id || '').toLowerCase();
  const s = (f.extra?.severity || '').toUpperCase();
  if (/sqli|secret|jwt|rce|injection/.test(id)) return 'critical';
  if (s === 'ERROR') return 'high';
  if (s === 'WARNING') return 'medium';
  return 'low';
}

async function emit(ev) {
  try {
    const r = await fetch(EMIT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev) });
    if (!r.ok) console.error('[semgrep-agent] emit', r.status, ev.target_component);
  } catch (e) { console.error('[semgrep-agent] emit failed', e.message); }
}

function runSemgrep() {
  const args = ['scan', '--config', RULES, '--config', 'p/javascript', '--config', 'p/owasp-top-ten',
    '--config', 'p/secrets', '--json', '--quiet', '--metrics=off', TARGET_DIR];
  const r = spawnSync(SEMGREP, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (r.error) { console.error('[semgrep-agent] cannot run semgrep:', r.error.message); return []; }
  try { return JSON.parse(r.stdout || '{}').results || []; }
  catch { console.error('[semgrep-agent] bad semgrep output'); return []; }
}

async function main() {
  console.error(`SEMGREP agent · scanning ${TARGET_DIR} · run=${RUN_ID}`);
  await emit({ run_id: RUN_ID, event_type: 'attack_started', agent_id: AGENT_ID, agent_persona: PERSONA,
    target_component: 'source', description: 'semgrep: static analysis of target source', ts: nowIso() });

  const results = runSemgrep();
  // de-dupe by (check_id, file, line)
  const seen = new Set();
  let n = 0;
  for (const f of results) {
    const file = (f.path || '').split('/').pop();
    const line = f.start?.line;
    const key = `${f.check_id}|${file}|${line}`;
    if (seen.has(key)) continue; seen.add(key);
    const rule = (f.check_id || 'rule').split('.').pop();
    await emit({
      run_id: RUN_ID, event_type: 'weakness_found', agent_id: AGENT_ID, agent_persona: PERSONA,
      target_component: `${file}:${line}`,
      severity: sevOf(f),
      description: `${rule} — ${(f.extra?.message || '').replace(/\s+/g, ' ').trim().slice(0, 140)}`,
      payload: rule,
      evidence: (f.extra?.lines || '').trim().slice(0, 160),
      rule,
      ts: nowIso(),
    });
    n++;
    console.error(`  ✔ ${sevOf(f).toUpperCase()} ${file}:${line} — ${rule}`);
  }
  console.error(`SEMGREP agent done · ${n} findings emitted · run=${RUN_ID}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
