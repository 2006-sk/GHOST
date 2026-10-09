// server.js — TowerBank, a DELIBERATELY VULNERABLE demo banking API.
// ─────────────────────────────────────────────────────────────────────────
// ⚠️  This app is INTENTIONALLY INSECURE. It is a target for the GHOST red-team
//     siege and for static scanners (Semgrep). Run on localhost only. Never
//     deploy. Every planted flaw is tagged `// VULN[class]:` so the findings
//     line up with the GHOST detection rules and the report-card code fixes.
// ─────────────────────────────────────────────────────────────────────────
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  users, accounts, products, coupons, unsafeQuery,
  SERVER_SECRETS, ASSISTANT_SYSTEM_PROMPT,
} from "./db.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const PORT = Number(process.env.PORT || 4000);

app.use(express.static(join(__dir, "public")));

// ── recon surface: robots.txt advertises the sensitive paths ───────────────
// VULN[recon]: leaks the staff-only routes instead of gating them by auth.
app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send(
    "User-agent: *\nDisallow: /admin\nDisallow: /api/internal/config\nDisallow: /api/export\n"
  );
});

// ── login ──────────────────────────────────────────────────────────────────
// VULN[auth_bypass/sqli]: username/password concatenated into the query, so
//   username = admin'--  logs in as admin with no password.
app.post("/api/login", (req, res) => {
  const { username = "", password = "" } = req.body || {};
  const where = `username='${username}' AND password='${password}'`;
  const rows = unsafeQuery("users", where);
  if (rows.length) {
    const u = rows[0];
    return res.json({ ok: true, token: signTokenInsecure({ sub: u.id, role: u.role }), user: { id: u.id, role: u.role } });
  }
  res.status(401).json({ ok: false, error: "invalid credentials" });
});

// ── search ───────────────────────────────────────────────────────────────
// VULN[sqli]: query built by string concat → ' OR 1=1 -- dumps everything.
// VULN[xss]: q reflected into the HTML response unescaped.
app.get("/api/search", (req, res) => {
  const q = String(req.query.q || "");
  const rows = unsafeQuery("users", `username='${q}'`);
  const html = `<h3>Results for ${q}</h3><pre>${JSON.stringify(rows, null, 2)}</pre>`;
  if (req.query.format === "html") return res.type("html").send(html);
  res.json({ q, count: rows.length, rows });
});

// ── user record ────────────────────────────────────────────────────────────
// VULN[idor]: no ownership/authorization check — any id returns full PII.
app.get("/api/user/:id", (req, res) => {
  const u = users.find((x) => String(x.id) === String(req.params.id));
  if (!u) return res.status(404).json({ error: "not found" });
  res.json(u); // returns ssn, card, balance, password…
});

// ── account lookup ──────────────────────────────────────────────────────────
// VULN[idor]: ?id= trusted directly.
app.get("/api/account", (req, res) => {
  const a = accounts.find((x) => String(x.id) === String(req.query.id));
  if (!a) return res.status(404).json({ error: "not found" });
  res.json(a);
});

// ── money transfer ──────────────────────────────────────────────────────────
// VULN[logic_abuse]: no ownership check, no positivity check — a negative
//   amount reverses the flow (pulls money toward the attacker).
app.post("/api/transfer", (req, res) => {
  const { from, to, amount } = req.body || {};
  const src = accounts.find((a) => String(a.id) === String(from));
  const dst = accounts.find((a) => String(a.id) === String(to));
  if (!src || !dst) return res.status(400).json({ error: "bad accounts" });
  const amt = Number(amount);
  src.balance -= amt; // amt may be negative → theft
  dst.balance += amt;
  res.json({ ok: true, from: src, to: dst });
});

// ── checkout with coupons ────────────────────────────────────────────────────
// VULN[logic_abuse]: coupons stack with no server validation → negative total.
app.post("/api/checkout", (req, res) => {
  const { product_id, coupons: codes = [] } = req.body || {};
  const p = products.find((x) => x.id === Number(product_id)) || products[0];
  let total = p.price;
  for (const c of codes) {
    const found = coupons.find((k) => k.code === c) || { pct: 10 }; // unknown codes still discount!
    total -= p.price * (found.pct / 100);
  }
  res.json({ ok: true, product: p.name, total }); // total can go negative
});

// VULN[logic_abuse]: refund reuses the same broken coupon math.
app.post("/api/refund", (req, res) => {
  const amount = Number(req.body?.amount ?? 0);
  res.json({ ok: true, refunded: amount }); // no bound / idempotency check
});

// ── bulk export ──────────────────────────────────────────────────────────────
// VULN[dos/pii]: unauthenticated, unpaginated, unthrottled dump of all PII.
app.get("/api/export", (_req, res) => {
  res.json({ count: users.length, users }); // every user's ssn/card/password
});

// ── admin panel ──────────────────────────────────────────────────────────────
// VULN[broken_access_control]: no auth/role check; serves a secret too.
app.get("/admin", (_req, res) => {
  res.type("html").send(
    `<h1>TowerBank Admin</h1><p>Signing key: <code>${SERVER_SECRETS.JWT_SECRET}</code></p>` +
    `<ul>${users.map((u) => `<li>${u.username} — ${u.role} — ${u.ssn}</li>`).join("")}</ul>`
  );
});

// ── internal config ──────────────────────────────────────────────────────────
// VULN[info_disclosure]: dumps DB creds + signing key + live payment key.
app.get("/api/internal/config", (_req, res) => {
  res.json(SERVER_SECRETS);
});

// ── JWT-protected "me" (but the verifier is broken) ─────────────────────────
// VULN[auth_bypass/jwt]: accepts alg:none, so a forged unsigned token with
//   role=admin is accepted.
app.get("/api/me", (req, res) => {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const claims = verifyTokenInsecure(token);
  if (!claims) return res.status(401).json({ error: "no/invalid token" });
  res.json({ claims, note: claims.role === "admin" ? "admin access granted" : "customer" });
});

// ── support assistant (LLM-facing) ───────────────────────────────────────────
// VULN[prompt_injection]: concatenates the user message after a system prompt
//   that contains a secret; a "ignore previous instructions" message leaks it.
app.post("/api/assistant", (req, res) => {
  const msg = String(req.body?.message || "");
  // A real app would call an LLM here; we emulate the injectable behaviour.
  let reply = "How can I help with your account today?";
  if (/ignore (previous|above)|system prompt|reveal|secret|flag/i.test(msg)) {
    reply = ASSISTANT_SYSTEM_PROMPT; // leaks the hidden prompt + flag
  }
  res.json({ reply });
});

app.get("/api/health", (_req, res) => res.json({ ok: true, app: "towerbank", vulnerable: true }));

// ── insecure JWT helpers (base64url, alg:none accepted) ──────────────────────
function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString("base64url"); }
function signTokenInsecure(claims) {
  // "signs" with alg:none — no signature at all (planted weakness).
  return `${b64url({ alg: "none", typ: "JWT" })}.${b64url(claims)}.`;
}
function verifyTokenInsecure(token) {
  try {
    const [h, p] = token.split(".");
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    // VULN: trusts alg:none and never checks a signature.
    if (header.alg === "none") return payload;
    return payload; // (still no real verification)
  } catch { return null; }
}

app.listen(PORT, () => {
  console.log(`⚠️  TowerBank (INTENTIONALLY VULNERABLE) on http://localhost:${PORT}`);
  console.log(`    endpoints: /api/login /api/search /api/user/:id /api/account /api/transfer`);
  console.log(`               /api/checkout /api/refund /api/export /admin /api/internal/config`);
  console.log(`               /api/me (JWT) /api/assistant (LLM) /robots.txt`);
});
