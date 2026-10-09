// playbooks/netscan.ts — MOCK content (labels only; nothing is executed).
import type { Playbook } from "../agents/base";

export const netscanPlaybook: Playbook = {
  persona: "netscan",
  components: ["tcp/22", "tcp/5432", "tcp/6379", "tcp/9200", "debug/9229"],
  techniques: [
    { payload: "scan tcp/5432", desc: "Postgres 5432 exposed to 0.0.0.0", severity: "high", land_rate: 0.6 },
    { payload: "scan tcp/6379", desc: "Redis 6379 no auth", severity: "critical", land_rate: 0.4 },
    { payload: "scan tcp/9229", desc: "Node debug port 9229 reachable", severity: "high", land_rate: 0.4 },
    { payload: "scan 1-1024", desc: "all closed except 443", severity: "info", land_rate: 0.5 },
  ],
};
