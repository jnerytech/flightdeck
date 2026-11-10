// The automations of a project: triggers (time, PR comment, failing checks, labeled issue) and the action each fires (issue #1600: moved from index.ts).
import { z } from "zod";
import { cmd } from "./command.ts";

/** Phase 13: what fires an automation. */
export const AutomationTrigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cron"), expr: z.string().min(1), tz: z.string().min(1) }),
  z.object({ type: z.literal("pr_comment") }),
  z.object({ type: z.literal("ci_failed") }),
  z.object({ type: z.literal("issue_label"), label: z.string().min(1) }),
]);
export type AutomationTrigger = z.infer<typeof AutomationTrigger>;

/** Phase 13: what an automation does. */
export const AutomationAction = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start_workflow"),
    workflow: z.string().min(1),
    inputs: z.record(z.string(), z.string()).optional(),
    /** The new card's title (the automation's name when absent) and description. */
    title: z.string().min(1).optional(),
    description: z.string().optional(),
  }),
  z.object({ type: z.literal("send_to_card") }),
  z.object({ type: z.literal("create_card") }),
]);
export type AutomationAction = z.infer<typeof AutomationAction>;

/** Phase 13: an automation of a project; born off, and turned on only with a confirmation. */
export const Automation = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  trigger: AutomationTrigger,
  action: AutomationAction,
  maxRunsPerDay: z.number().int(),
  /** Act on content from third parties too (always marked untrusted, with auto-approval suspended). */
  allowExternalAuthors: z.boolean(),
  createdAt: z.string(),
});
export type Automation = z.infer<typeof Automation>;

export const AutomationRun = z.object({
  id: z.string(),
  automationId: z.string(),
  firedAt: z.string(),
  cause: z.string(),
  status: z.enum(["ok", "failed", "ignored", "skipped", "limited", "missed"]),
  detail: z.string().nullable(),
});
export type AutomationRun = z.infer<typeof AutomationRun>;

/** The automations commands; index.ts spreads them into `Command`. */
export const automationsCommands = [
  /** Phase 13: a project's automations; `save` always leaves them off. */
  cmd("automation.list", z.object({ projectId: z.string() })),
  cmd(
    "automation.save",
    z.object({
      projectId: z.string(),
      id: z.string().optional(),
      name: z.string().min(1),
      trigger: AutomationTrigger,
      action: AutomationAction,
      maxRunsPerDay: z.number().int().min(1).optional(),
      allowExternalAuthors: z.boolean().optional(),
    }),
  ),
  cmd("automation.remove", z.object({ id: z.string(), confirm: z.boolean().optional() })),
  /** Turning on needs `confirm`: the app shows the trigger and the action first. */
  cmd(
    "automation.toggle",
    z.object({ id: z.string(), enabled: z.boolean(), confirm: z.boolean().optional() }),
  ),
  cmd(
    "automation.runs",
    z.object({ id: z.string(), limit: z.number().int().min(1).max(500).optional() }),
  ),
] as const;

/** The `data` of each automations command's ack; `CommandResults` extends it. */
export interface AutomationsResults {
  "automation.list": { automations: Automation[] };
  "automation.save": Automation;
  "automation.remove": { automations: Automation[] };
  "automation.toggle": Automation;
  "automation.runs": { runs: AutomationRun[] };
}
