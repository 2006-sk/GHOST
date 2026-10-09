// playbooks/recon.ts — MOCK content (labels only; nothing is executed).
// Stored as a TS module, not a runtime-read .json file, because the Guild
// sandbox has no filesystem access at runtime.
import type { Playbook } from "../agents/base";

export const reconPlaybook: Playbook = {
  persona: "recon",
  components: ["/", "/admin", "/.git", "robots.txt", "/api"],
  techniques: [
    { payload: "GET /", desc: "mapped 6 endpoints", severity: "info", land_rate: 0.95 },
    { payload: "GET /admin", desc: "/admin unlinked but live", severity: "low", land_rate: 0.6 },
    { payload: "GET /.git/HEAD", desc: "exposed .git metadata", severity: "low", land_rate: 0.4 },
    { payload: "GET robots.txt", desc: "robots.txt reveals hidden paths", severity: "info", land_rate: 0.7 },
  ],
};
