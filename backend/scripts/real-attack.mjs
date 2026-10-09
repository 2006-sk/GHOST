// real-attack.mjs — REAL mode: a fast LLM (Nebius) drives genuine attacks on a
// live target and emits real §4.4 events to the coordinator.
//
// Loop per persona:  LLM plans attacks  →  we execute them against the target
//   (real HTTP, real payloads, real responses)  →  LLM judges each response
//   (weakness or held?)  →  we emit attack_started + weakness_found/attack_result
//   with the REAL http_status + evidence. The coordinator still owns detection.
//
//   node scripts/real-attack.mjs
// Env (from backend/.env):
//   NEBIUS_API_KEY, NEBIUS_BASE_URL, NEBIUS_MODEL
//   TARGET_URL  (default http://localhost:4000)   EMIT_URL (default :8080/events)
//   RUN_ID      (default run_real_<ts>)            MAX_PER_AGENT (default 3)
import './../src/env.js';

const NEBIUS_KEY = process.env.NEBIUS_API_KEY;
const NEBIUS_BASE = (process.env.NEBIUS_BASE_URL || 'https://api.studio.nebius.com/v1').replace(/\/$/, '');
const MODEL = process.env.NEBIUS_MODEL || 'zai-org/GLM-5.3-Flash';
const TARGET = (process.env.TARGET_URL || 'http://localhost:4000').replace(/\/$/, '');
const EMIT_URL = process.env.EMIT_URL || 'http://localhost:8080/events';
const RUN_ID = process.env.RUN_ID || `run_real_${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`;
const MAX = Number(process.env.MAX_PER_AGENT || 3);

if (!NEBIUS_KEY) { console.error('NEBIUS_API_KEY not set (backend/.env)'); process.exit(1); }

const AGENTS = [
  { id: 'agent-1', persona: 'recon',       brief: 'Map the attack surface: pull /robots.txt, probe /admin, /api/internal/config, fingerprint routes.' },
  { id: 'agent-2', persona: 'netscan',     brief: 'Look for exposed services/ports/debug endpoints and info leaks in responses.' },
  { id: 'agent-3', persona: 'injection',   brief: "SQL injection (e.g. q=' OR 1=1 --), reflected XSS, and prompt injection on LLM endpoints like /api/assistant." },
  { id: 'agent-4', persona: 'auth_bypass', brief: 'IDOR (/api/user/:id, /api/account?id=), broken access control (/admin), forged alg:none JWT on /api/me, info disclosure.' },
  { id: 'agent-5', persona: 'dos',         brief: 'Unauthenticated/expensive endpoints and missing rate limits (e.g. /api/export, /api/search).' },
  { id: 'agent-6', persona: 'logic_abuse', brief: 'Business-logic abuse: coupon stacking on /api/checkout, negative amounts on /api/transfer, refund abuse.' },
];

// Real endpoint inventory of the target (what a recon pass would discover) —
// given to the planner so attacks hit real routes instead of guessed ones.
const ENDPOINTS = [
  'POST /api/login {username,password}', 'GET /api/search?q=', 'GET /api/user/:id',
  'GET /api/account?id=', 'POST /api/transfer {from,to,amount}',
  'POST /api/checkout {product_id,coupons:[]}', 'POST /api/refund {amount}',
  'GET /api/export', 'GET /admin', 'GET /api/internal/config',
  'GET /api/me (Authorization: Bearer <jwt>)', 'POST /api/assistant {message}', 'GET /robots.txt',
];

const nowIso = () => new Date().toISOString();

async function llm(messages, { max_tokens = 3000 } = {}) {
  // NOTE: GLM-5.3-Flash is a reasoning model — it spends ~700 tokens thinking
  // before the answer, so budgets must be generous or content comes back empty.
  const res = await fetch(`${NEBIUS_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${NEBIUS_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, max_tokens, temperature: 0.4 }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  return d.choices?.[0]?.message?.content || '';
}

function parseJsonArray(text) {
  // tolerate ```json fences / prose around the array
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try { return JSON.parse(m[0]); } catch { return []; }
}

async function emit(ev) {
  try {
    const r = await fetch(EMIT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev) });
    if (!r.ok) console.error('[emit]', r.status, ev.event_type, ev.target_component);
  } catch (e) { console.error('[emit] failed', e.message); }
}

// Execute one planned attack against the live target. Returns {status, bodyText}.
async function execAttack(plan) {
  const url = `${TARGET}${plan.path}`;
  const opts = { method: (plan.method || 'GET').toUpperCase(), headers: {} };
  if (plan.headers) opts.headers = { ...plan.headers };
  if (plan.body != null && opts.method !== 'GET') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = typeof plan.body === 'string' ? plan.body : JSON.stringify(plan.body);
  }
  try {
    const r = await fetch(url, opts);
    const t = (await r.text()).slice(0, 1500);
    return { status: r.status, bodyText: t };
  } catch (e) { return { status: 0, bodyText: `request failed: ${e.message}` }; }
}

async function runPersona(a) {
  // 1) LLM plans the attacks
  const planText = await llm([
    { role: 'system', content: 'You are an authorized penetration-testing planner for a deliberately-vulnerable lab bank (localhost). Output ONLY a JSON array, no prose.' },
    { role: 'user', content:
      `Target base URL: ${TARGET} (TowerBank demo). You are the "${a.persona}" agent. ${a.brief}\n` +
      `Known endpoints (use these EXACT paths — do not invent others):\n${ENDPOINTS.map((e) => '  ' + e).join('\n')}\n` +
      `Propose up to ${MAX} concrete HTTP attacks against the relevant endpoints. Return a JSON array of objects: ` +
      `{"path":"/api/...","method":"GET|POST","body":{...}|null,"headers":{...}|null,"technique":"short label","intent":"what success looks like"}.` },
  ]).catch((e) => { console.error(`[${a.persona}] plan error`, e.message); return '[]'; });

  let plans = parseJsonArray(planText).slice(0, MAX);
  if (!plans.length) plans = [{ path: '/api/health', method: 'GET', technique: 'probe', intent: 'liveness' }];

  for (const plan of plans) {
    await emit({ run_id: RUN_ID, event_type: 'attack_started', agent_id: a.id, agent_persona: a.persona,
      target_component: plan.path, description: `${a.persona}: ${plan.technique || 'probe'} on ${plan.path}`, ts: nowIso() });

    const resp = await execAttack(plan);

    // 2) LLM judges the real response
    const verdictText = await llm([
      { role: 'system', content: 'You are a security judge. Given an attack and the REAL server response, decide if a vulnerability was confirmed. Output ONLY JSON.' },
      { role: 'user', content:
        `Attack: ${JSON.stringify(plan)}\nHTTP status: ${resp.status}\nResponse (truncated):\n${resp.bodyText}\n\n` +
        `Return {"weakness":true|false,"severity":"info|low|medium|high|critical","description":"one concrete sentence of what was proven"}.` },
    ], { max_tokens: 1500 }).catch(() => '{}');

    let v = {};
    try { v = JSON.parse((verdictText.match(/\{[\s\S]*\}/) || ['{}'])[0]); } catch { v = {}; }

    const base = { run_id: RUN_ID, agent_id: a.id, agent_persona: a.persona, target_component: plan.path,
      payload: typeof plan.body === 'object' ? JSON.stringify(plan.body) : (plan.body || plan.path),
      http_status: resp.status, evidence: resp.bodyText.slice(0, 180), src_ip: '127.0.0.1', ts: nowIso() };

    if (v.weakness) {
      await emit({ ...base, event_type: 'weakness_found', severity: v.severity || 'medium',
        description: v.description || `${plan.technique} succeeded on ${plan.path}` });
      console.error(`  [${a.persona}] ✔ ${String(v.severity||'medium').toUpperCase()} ${plan.path} — ${v.description||plan.technique}`);
    } else {
      await emit({ ...base, event_type: 'attack_result', severity: 'info',
        description: v.description || `${plan.technique} held on ${plan.path}` });
      console.error(`  [${a.persona}] ✕ held ${plan.path}`);
    }
  }
}

async function main() {
  console.error(`REAL attack · model=${MODEL} · target=${TARGET} · run=${RUN_ID}`);
  // recon first (seeds the narrative), then the rest in parallel
  const recon = AGENTS[0];
  await runPersona(recon);
  await Promise.all(AGENTS.slice(1).map(runPersona));
  console.error(`done. run_id=${RUN_ID}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
