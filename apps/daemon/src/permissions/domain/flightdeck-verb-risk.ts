import { AGENTCFG_RULES } from "./agentcfg-risk.ts";
import { BOARDSYNC_RULES } from "./boardsync-risk.ts";
import { MESSAGE_RULES } from "./message-risk.ts";
import { PROJECT_RULES } from "./project-risk.ts";
import { REVIEW_RULES } from "./review-risk.ts";
import { RUNENV_RULES } from "./runenv-risk.ts";
import { SNIPPET_RULES } from "./snippet-risk.ts";

/** The rules of the `flightdeckd` verbs that change or send something, in the order `risk.ts` reads them. */
export const FLIGHTDECK_VERB_RULES = [
  ...PROJECT_RULES,
  ...AGENTCFG_RULES,
  ...MESSAGE_RULES,
  ...BOARDSYNC_RULES,
  ...RUNENV_RULES,
  ...SNIPPET_RULES,
  ...REVIEW_RULES,
];
