// playbooks/logic_abuse.ts — MOCK content (labels only; nothing is executed).
import type { Playbook } from "../agents/base";

export const logicAbusePlaybook: Playbook = {
  persona: "logic_abuse",
  components: ["/api/checkout", "/api/cart", "/api/refund", "/api/coupon"],
  techniques: [
    { payload: "stack coupons", desc: "coupon stacks infinitely → -100% price", severity: "high", land_rate: 0.6 },
    { payload: "qty = -1", desc: "negative quantity → credit issued", severity: "critical", land_rate: 0.4 },
    { payload: "double refund", desc: "double-refund race", severity: "high", land_rate: 0.45 },
  ],
};
