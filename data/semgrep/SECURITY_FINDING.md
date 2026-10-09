# GHOST — Semgrep Security Finding (submission)

**Scanner:** Semgrep 1.180.0 · **Target:** `attacky/` (TowerBank demo bank)
**Rulesets:** `data/semgrep/ghost-rules.yml` (GHOST-tuned) + registry packs
`p/javascript`, `p/owasp-top-ten`, `p/secrets`.

```bash
semgrep scan \
  --config data/semgrep/ghost-rules.yml \
  --config p/javascript --config p/owasp-top-ten --config p/secrets \
  --metrics=off attacky/
```

---

## 🔴 Headline finding — SQL injection → auth bypass + full PII dump

- **Rule:** `ghost-sqli-user-input-to-query` (taint) · **Severity:** ERROR
- **CWE-89 (SQL Injection)** · **OWASP A03:2021 — Injection**
- **Location:** `attacky/server.js:51` (`POST /api/login`), same sink reached from
  `attacky/server.js:46` (`GET /api/search`)

### What Semgrep caught
Request-controlled input (`req.body`, `req.query`) flows **untouched** into the
query sink `unsafeQuery(...)`:

```js
// server.js:50-51  — /api/login
const { username = "", password = "" } = req.body || {};
const where = `username='${username}' AND password='${password}'`;  // ← tainted concat
const rows = unsafeQuery("users", where);                            // ← sink
```

### Why it matters (a banking app)
1. **Auth bypass:** `username = admin'--` comments out the password check → log in
   as any user with no credential.
2. **Full data exfiltration:** `GET /api/search?q=' OR 1=1 --` returns **every**
   customer row — names, emails, **SSNs**, card numbers, password. A reportable
   PII breach from a single unauthenticated request.

Both exploits were verified live against the running app.

### Fix
```js
// parameterize — input can never change the query structure
const rows = await db.query(
  "SELECT id, role, pass_hash FROM users WHERE username = ?", [username]
);
if (rows[0] && await bcrypt.compare(password, rows[0].pass_hash)) login(rows[0]);
// + least-privilege DB user, never SELECT *, never concatenate user input
```

---

## Full inventory (7 findings, 5 distinct)

| Rule | Sev | File:line | Class |
|---|---|---|---|
| `ghost-sqli-user-input-to-query` | ERROR | server.js:51 | CWE-89 SQL injection (+ auth bypass) |
| `ghost-secrets-in-http-response` | ERROR | server.js:124 | CWE-200 info disclosure (`/api/internal/config` leaks DB/signing/payment keys) |
| `ghost-jwt-alg-none-accepted` | ERROR | server.js:164 | CWE-347 forged `alg:none` JWT accepted |
| `raw-html-format` (registry) | WARNING | server.js:52 | CWE-79 reflected XSS |
| `ghost-unvalidated-money-amount` | WARNING | server.js:82-83 | CWE-840 negative-amount transfer logic abuse |

These line up 1:1 with the GHOST detection personas (injection, auth_bypass,
logic_abuse) and the report-card code fixes — static analysis (Semgrep) and the
live red-team siege agree on the same flaws.
