import { AGENTCFG_RULES } from "./agentcfg-risk.ts";
import { BOARDSYNC_RULES } from "./boardsync-risk.ts";
import { PROJECT_RULES } from "./project-risk.ts";
import { REVIEW_RULES } from "./review-risk.ts";

/** The rules of the `flightdeckd` verbs that change or send something, in the order `risk.ts` reads them. */
export const FLIGHTDECK_VERB_RULES = [
  ...PROJECT_RULES,
  ...AGENTCFG_RULES,
  ...BOARDSYNC_RULES,
  ...REVIEW_RULES,
];
