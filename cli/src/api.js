// api.js — thin fetch wrappers over the coordinator HTTP API (master.md §4.6).
// Nothing new server-side; this is a pure client.

async function req(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    const e = new Error(`cannot reach coordinator at ${url} — is the backend running?`);
    e.cause = err;
    e.offline = true;
    throw e;
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const e = new Error(json.error || `HTTP ${res.status} from ${url}`);
    e.status = res.status;
    e.body = json;
    throw e;
  }
  return json;
}

export function makeApi(base) {
  const json = (body) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    health: () => req(`${base}/health`),
    prepare: (body) => req(`${base}/api/prepare`, json(body)),
    status: () => req(`${base}/api/status`),
    run: (body) => req(`${base}/api/run`, json(body)),
    stop: () => req(`${base}/api/stop`, { method: 'POST' }),
    state: () => req(`${base}/state`),
  };
}
