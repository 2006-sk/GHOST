// playbooks/dos.ts — MOCK content (labels only; nothing is executed).
// IMPORTANT: there is NO flooding / load-generation engine anywhere in this
// repo. These are DESCRIPTIONS of resilience findings for the detection HUD.
// The agent emits them as events; it never sends traffic.
import type { Playbook } from "../agents/base";

export const dosPlaybook: Playbook = {
  persona: "dos",
  components: ["/api/search", "/api/upload", "/api/report"],
  techniques: [
    { payload: "rate-limit check /api/search", desc: "no rate limit on /api/search", severity: "medium", land_rate: 0.6 },
    { payload: "burst probe", desc: "10k req/s → 502s (observed in prior load test)", severity: "high", land_rate: 0.4 },
    { payload: "large-upload probe", desc: "upload bomb → OOM", severity: "high", land_rate: 0.4 },
  ],
};
