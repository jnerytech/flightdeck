import { AGENTCFG_RULES } from "./agentcfg-risk.ts";
import { BOARDSYNC_RULES } from "./boardsync-risk.ts";
import { MESSAGE_RULES } from "./message-risk.ts";
import { PROJECT_RULES } from "./project-risk.ts";

/**
 * The rules of the CLI nouns whose verbs each have a file of their own (a noun per file, so `risk.ts` stays under
 * the size limit as the CLI grows). Every rule that applies is a candidate and the highest wins, so the order only
 * decides which reason is said first.
 */
export const CLI_VERB_RULES = [
  ...PROJECT_RULES,
  ...AGENTCFG_RULES,
  ...MESSAGE_RULES,
  ...BOARDSYNC_RULES,
];
