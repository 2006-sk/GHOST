// guild.js — real Guild API client (https://api.guild.ai).
// Auth is `Authorization: Bearer <workspace-id:glda_token>` (the FULL key).
// Verified working: /v1/me authenticates; /v1/agents lists.
//
// Running the six GHOST personas for real needs them DEPLOYED to the workspace
// first (guild CLI: `guild agent init` + guild/deploy.sh). Until then this
// client authenticates, lists, and reports what's missing — it never fakes a
// session. The coordinator stays in MOCK and the siege is unaffected.

const KEY = process.env.GUILD_API_KEY || '';
const BASE = (process.env.GUILD_BASE_URL || 'https://api.guild.ai/v1').replace(/\/$/, '');
// workspace id is the part before ':' in the key, unless overridden
const WS = process.env.GUILD_WORKSPACE || (KEY.includes(':') ? KEY.split(':')[0] : '');

export const guildEnabled = Boolean(KEY);
export const GHOST_PERSONAS = ['recon', 'netscan', 'injection', 'auth_bypass', 'dos', 'logic_abuse'];

async function gfetch(path, opts = {}) {
  if (!KEY) throw Object.assign(new Error('GUILD_API_KEY not set'), { status: 0 });
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });
  } catch (err) {
    throw Object.assign(new Error(`Guild unreachable: ${err.message}`), { status: 0, offline: true });
  }
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    throw Object.assign(new Error(json.message || json.error || `Guild HTTP ${res.status}`), { status: res.status, body: json });
  }
  return json;
}

export const whoami = () => gfetch('/me');
export const listAgents = (mine = true) => gfetch(`/agents?mine=${mine}`).then((d) => d.items || []);
export const listWorkspaceAgents = () =>
  gfetch(`/workspaces/${WS}/workspace_agents`).then((d) => d.items || []).catch(() => []);
export const listSessions = () =>
  gfetch(`/workspaces/${WS}/sessions`).then((d) => d.items || []).catch(() => []);

// Create a session in the workspace (optionally bound to a workspace_agent).
export const createSession = (body = {}) =>
  gfetch(`/workspaces/${WS}/sessions`, { method: 'POST', body: JSON.stringify(body) });
// Drive a session with a text event (the §4.7 agent input, serialized).
export const sendSessionEvent = (sessionId, text) =>
  gfetch(`/sessions/${sessionId}/events`, { method: 'POST', body: JSON.stringify({ type: 'text', text }) });
export const getSessionEvents = (sessionId) =>
  gfetch(`/sessions/${sessionId}/events`).then((d) => d.items || d.events || []);

function ghostOf(agents) {
  return agents.filter((a) => {
    const n = String(a.name || (a.agent && a.agent.name) || '').toLowerCase();
    return n.startsWith('ghost-') || GHOST_PERSONAS.some((p) => n === `ghost-${p}`);
  });
}

// One call the coordinator/status endpoint uses: authenticated? which ghost
// agents are deployed? Never throws — returns a structured report.
export async function guildStatus() {
  if (!KEY) return { enabled: false, authenticated: false, reason: 'GUILD_API_KEY not set' };
  try {
    const me = await whoami();
    const [agents, wa] = await Promise.all([listAgents().catch(() => []), listWorkspaceAgents()]);
    const ghost = ghostOf(wa.length ? wa : agents);
    return {
      enabled: true,
      authenticated: true,
      account: me.name || me.slug || null,
      workspace: WS,
      agents_total: agents.length,
      workspace_agents: wa.length,
      ghost_agents_deployed: ghost.length,
      ghost_agents: ghost.map((a) => a.name || (a.agent && a.agent.name)).filter(Boolean),
      ready_for_real_mode: ghost.length >= 6,
      note: ghost.length >= 6
        ? 'all six GHOST personas deployed — real mode can start sessions'
        : 'GHOST personas not deployed yet — run guild/deploy.sh (needs the guild CLI). Coordinator stays in MOCK.',
    };
  } catch (err) {
    return { enabled: true, authenticated: false, error: err.message, status: err.status };
  }
}

// Start one Guild session per deployed ghost persona, driving it with the §4.7
// input. Returns what actually happened (honest about missing agents).
export async function startGhostSessions(input /* {run_id, mode, target, emit_url, intensity} */) {
  const status = await guildStatus();
  if (!status.authenticated) return { ok: false, error: status.error || status.reason, guild: status };
  if (!status.ready_for_real_mode) return { ok: false, error: status.note, guild: status };

  const wa = await listWorkspaceAgents();
  const ghost = ghostOf(wa);
  const started = [];
  for (const persona of GHOST_PERSONAS) {
    const agent = ghost.find((a) => String(a.name || '').toLowerCase().includes(persona));
    if (!agent) continue;
    try {
      const session = await createSession({ workspace_agent_id: agent.id });
      const sid = session.id || session.session_id;
      await sendSessionEvent(sid, JSON.stringify({ ...input, agent_persona: persona }));
      started.push({ persona, session_id: sid });
    } catch (err) {
      console.error(`[guild] start ${persona} failed:`, err.message);
    }
  }
  return { ok: started.length > 0, started, count: started.length, guild: status };
}
