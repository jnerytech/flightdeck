import { ACTION_RULES } from "./action-risk.ts";
import { AGENTCFG_RULES } from "./agentcfg-risk.ts";
import { AUTOMATION_RULES } from "./automation-risk.ts";
import { BG_RULES } from "./bg-risk.ts";
import { BOARDSYNC_RULES } from "./boardsync-risk.ts";
import { CHANGES_RULES } from "./changes-risk.ts";
import { DAEMON_RULES } from "./daemon-risk.ts";
import { EXTERNAL_RULES } from "./external-risk.ts";
import { FILE_RULES } from "./file-risk.ts";
import { HOST_RULES } from "./host-risk.ts";
import { KNOWLEDGE_RULES } from "./knowledge-risk.ts";
import { LOGS_RULES } from "./logs-risk.ts";
import { MAINTENANCE_RULES } from "./maintenance-risk.ts";
import { MCP_RULES } from "./mcp-risk.ts";
import { MEMORY_RULES } from "./memory-risk.ts";
import { MESSAGE_RULES } from "./message-risk.ts";
import { PROJECT_RULES } from "./project-risk.ts";
import { REVIEW_RULES } from "./review-risk.ts";
import { REWIND_RULES } from "./rewind-risk.ts";
import { RUNENV_RULES } from "./runenv-risk.ts";
import { SEND_RULES } from "./send-risk.ts";
import { SNIPPET_RULES } from "./snippet-risk.ts";
import { TELEMETRY_RULES } from "./telemetry-risk.ts";
import { TELEPORT_RULES } from "./teleport-risk.ts";
import { UI_RULES } from "./ui-risk.ts";
import { WORKFLOW_RULES } from "./workflow-risk.ts";
import { WORKTREE_RULES } from "./worktree-risk.ts";

/** The rules of the `flightdeckd` verbs that change or send something, in the order `risk.ts` reads them. */
export const FLIGHTDECK_VERB_RULES = [
  ...PROJECT_RULES,
  ...AGENTCFG_RULES,
  ...MESSAGE_RULES,
  ...BOARDSYNC_RULES,
  ...RUNENV_RULES,
  ...AUTOMATION_RULES,
  ...ACTION_RULES,
  ...SNIPPET_RULES,
  ...REVIEW_RULES,
  ...EXTERNAL_RULES,
  ...MEMORY_RULES,
  ...LOGS_RULES,
  ...HOST_RULES,
  ...WORKFLOW_RULES,
  ...MCP_RULES,
  ...CHANGES_RULES,
  ...REWIND_RULES,
  ...BG_RULES,
  ...FILE_RULES,
  ...WORKTREE_RULES,
  ...SEND_RULES,
  ...KNOWLEDGE_RULES,
  ...TELEMETRY_RULES,
  ...DAEMON_RULES,
  ...MAINTENANCE_RULES,
  ...UI_RULES,
  ...TELEPORT_RULES,
];
