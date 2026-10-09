// playbooks/index.ts — persona → playbook lookup.
import type { Persona, Playbook } from "../agents/base";
import { reconPlaybook } from "./recon";
import { netscanPlaybook } from "./netscan";
import { injectionPlaybook } from "./injection";
import { authBypassPlaybook } from "./auth_bypass";
import { dosPlaybook } from "./dos";
import { logicAbusePlaybook } from "./logic_abuse";

export const playbooks: Record<Persona, Playbook> = {
  recon: reconPlaybook,
  netscan: netscanPlaybook,
  injection: injectionPlaybook,
  auth_bypass: authBypassPlaybook,
  dos: dosPlaybook,
  logic_abuse: logicAbusePlaybook,
};
