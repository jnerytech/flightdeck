import { AGENTCFG_RULES } from "./agentcfg-risk.ts";
import { BOARDSYNC_RULES } from "./boardsync-risk.ts";
import { PROJECT_RULES } from "./project-risk.ts";
import { RUNENV_RULES } from "./runenv-risk.ts";
import { SNIPPET_RULES } from "./snippet-risk.ts";

/**
 * The rules each `flightdeckd` noun keeps in its own file, as the one list `risk.ts` reads: a new noun adds
 * its file and one line here, and `risk.ts` (held under the source-size limit) does not grow.
 */
export const NOUN_RULES = [
  ...PROJECT_RULES,
  ...AGENTCFG_RULES,
  ...BOARDSYNC_RULES,
  ...RUNENV_RULES,
  ...SNIPPET_RULES,
];
