// playbooks/auth_bypass.ts — MOCK content (labels only; nothing is executed).
// Descriptions name the class of finding for the HUD; no forgery or escalation
// is performed by these agents.
import type { Playbook } from "../agents/base";

export const authBypassPlaybook: Playbook = {
  persona: "auth_bypass",
  components: ["/api/settings", "/api/export", "/api/token", "/api/admin"],
  techniques: [
    { payload: "IDOR /api/settings?user=2", desc: "IDOR: read another user's settings", severity: "high", land_rate: 0.6 },
    { payload: "JWT alg:none", desc: "forged JWT alg:none accepted", severity: "critical", land_rate: 0.4 },
    { payload: "GET /api/export (no auth)", desc: "no auth on /api/export", severity: "high", land_rate: 0.5 },
  ],
};
