// The Permission context: the modes of a session, its requests (with their plain wording and risk), auto-approval and the saved rules (issue #1600: moved from index.ts).

import { z } from "zod";
import { cmd } from "./command.ts";
import { LocalizedText } from "./localized-text.ts";

/** How a request reads to someone who does not use a terminal, in both languages (phase 33). */
export const PlainInfo = z.object({
  kind: z.enum([
    "create",
    "replace",
    "change",
    "delete",
    "move",
    "copy",
    "read",
    "web",
    "helper",
    "run",
  ]),
  sentence: LocalizedText,
  consequence: LocalizedText,
  reversible: z.boolean(),
  /** `needs_full_access`: simple mode does not show it, the task pauses. */
  outcome: z.enum(["ask", "needs_full_access"]),
  /** The yes is held for two seconds. */
  hold: z.boolean(),
});
export type PlainInfo = z.infer<typeof PlainInfo>;

export const ToolInput = z.record(z.string(), z.unknown());
export type ToolInput = z.infer<typeof ToolInput>;

export const PermissionMode = z.enum([
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "dontAsk",
  "auto",
]);
export type PermissionMode = z.infer<typeof PermissionMode>;
/** The modes a live session can be switched to (never one that skips the questions). */
/** `bypassPermissions` is refused by the daemon unless the host's switch is on. */
export const SettableMode = z.enum(["default", "acceptEdits", "plan", "bypassPermissions"]);
export type SettableMode = z.infer<typeof SettableMode>;

export const PermissionResolution = z.enum(["allow", "deny", "cancelled", "expired"]);
export type PermissionResolution = z.infer<typeof PermissionResolution>;

/** Phase 13: the risk of a permission request, from declared rules (never from AI). */
export const RiskLevel = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

/** Phase 13: how a request was approved automatically: by rule (low risk) or by the AI. */
export const AutoApproval = z.object({
  by: z.enum(["rule", "ai"]),
  reason: z.string(),
  model: z.string().nullable(),
});
export type AutoApproval = z.infer<typeof AutoApproval>;

/** Phase 13: one decision of the automatic approval. */
export const AutoApprovalRecord = z.object({
  id: z.string(),
  projectId: z.string(),
  /** The managed session's id, or the terminal session's Claude id. */
  sessionKey: z.string(),
  requestId: z.string(),
  toolName: z.string(),
  risk: z.string(),
  decision: z.enum(["allow", "ask"]),
  reason: z.string(),
  by: z.enum(["rule", "ai"]),
  model: z.string().nullable(),
  at: z.string(),
});
export type AutoApprovalRecord = z.infer<typeof AutoApprovalRecord>;

export const AutoApproveSuspension = z.object({
  sessionKey: z.string(),
  reason: z.string(),
  at: z.string(),
});
export type AutoApproveSuspension = z.infer<typeof AutoApproveSuspension>;

/** An open permission request, as listed in `session.summary`. */
export const PendingPermission = z.object({
  requestId: z.string(),
  toolName: z.string(),
  createdAt: z.string(),
  /** Phase 8: the tool input with long strings cut, for the tray's "ferramenta: resumo". */
  input: z.record(z.string(), z.unknown()).optional(),
  /** Phase 13; optional only because older daemons do not send it. */
  risk: RiskLevel.optional(),
  riskReason: z.string().optional(),
  /** Issue #88: the request in plain words, as `permission.requested` carries it; an older daemon sends none. */
  plain: PlainInfo.optional(),
});
export type PendingPermission = z.infer<typeof PendingPermission>;

// Phase 7 (track B): the SDK's PermissionUpdate, for "permitir nesta sessão / sempre neste projeto".
export const PermissionDestination = z.enum([
  "userSettings",
  "projectSettings",
  "localSettings",
  "session",
  "cliArg",
]);
export type PermissionDestination = z.infer<typeof PermissionDestination>;

export const PermissionRule = z.object({
  toolName: z.string(),
  ruleContent: z.string().optional(),
});
export type PermissionRule = z.infer<typeof PermissionRule>;

const RulesUpdate = <T extends string>(type: T) =>
  z.object({
    type: z.literal(type),
    rules: z.array(PermissionRule),
    behavior: z.enum(["allow", "deny", "ask"]),
    destination: PermissionDestination,
  });

const DirectoriesUpdate = <T extends string>(type: T) =>
  z.object({
    type: z.literal(type),
    directories: z.array(z.string()),
    destination: PermissionDestination,
  });

export const PermissionUpdate = z.discriminatedUnion("type", [
  RulesUpdate("addRules"),
  RulesUpdate("replaceRules"),
  RulesUpdate("removeRules"),
  z.object({
    type: z.literal("setMode"),
    mode: PermissionMode,
    destination: PermissionDestination,
  }),
  DirectoriesUpdate("addDirectories"),
  DirectoriesUpdate("removeDirectories"),
]);
export type PermissionUpdate = z.infer<typeof PermissionUpdate>;

export const PermissionRespondPayload = z.object({
  requestId: z.string(),
  decision: z.enum(["allow", "deny"]),
  message: z.string().optional(),
  updatedInput: ToolInput.optional(),
  /** Only the request's own suggestions or a project rule; anything else is refused. */
  updatedPermissions: z.array(PermissionUpdate).optional(),
  /**
   * The Approve was held its full time (#245, #251): a high-risk request is allowed only with it.
   * Absent from an older app, which a newer host refuses only for a high-risk allow.
   */
  held: z.boolean().optional(),
});

/** Phase 13: the project's automatic approval, off by default. */
export const AutoApproveSettings = z.object({
  enabled: z.boolean().default(false),
  model: z.string().min(1).default("claude-haiku-5-5"),
  /** Low risk approved without asking the AI. */
  lowWithoutAi: z.boolean().default(true),
});
export type AutoApproveSettings = z.infer<typeof AutoApproveSettings>;

/** The permissions commands; index.ts spreads them into `Command`. */
export const permissionsCommands = [
  cmd("permission.respond", PermissionRespondPayload),
  /** Phase 13: the automatic approvals' decisions (newest first) and the suspended sessions. */
  cmd(
    "autoapprove.list",
    z.object({
      projectId: z.string().optional(),
      sessionKey: z.string().optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    }),
  ),
  /** Turns the automatic approval back on in a session that got third-party content. */
  cmd("autoapprove.resume", z.object({ sessionKey: z.string(), confirm: z.boolean().optional() })),
  /** `permissions.allow` of the project's `.claude/settings.local.json`. */
  cmd("rules.list", z.object({ projectId: z.string() })),
  cmd(
    "rules.remove",
    z.object({ projectId: z.string(), rule: z.string().min(1), confirm: z.boolean().optional() }),
  ),
] as const;

/** The `data` of each permissions command's ack; `CommandResults` extends it. */
export interface PermissionsResults {
  "permission.respond": undefined;
  "autoapprove.list": { decisions: AutoApprovalRecord[]; suspended: AutoApproveSuspension[] };
  "autoapprove.resume": { suspended: AutoApproveSuspension[] };
  "rules.list": { rules: string[] };
  "rules.remove": { rules: string[] };
}
