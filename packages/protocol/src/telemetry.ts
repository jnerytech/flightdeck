// Telemetry: the OTLP export of Claude Code, received locally, with timings and never text (issue #1600: moved from index.ts).
import { z } from "zod";
import { cmd } from "./command.ts";

/** One step of a prompt in a session's timeline (phase 23). */
export const TelemetryItem = z.object({
  kind: z.enum(["tool", "permission", "api", "error"]),
  /** Epoch ms. */
  at: z.number(),
  toolName: z.string().nullable(),
  durationMs: z.number().nullable(),
  costUsd: z.number().nullable(),
  success: z.boolean().nullable(),
  /** The tool's `error_type` or the HTTP status of an API error. */
  error: z.string().nullable(),
  /** `accept` or `reject`, for a permission. */
  decision: z.string().nullable(),
  /** Who decided: `config`, `hook`, `user_temporary`... */
  source: z.string().nullable(),
  /** For a permission a person answered: the time from the step before it to the answer. */
  waitMs: z.number().nullable(),
});
export type TelemetryItem = z.infer<typeof TelemetryItem>;

export const TelemetryPrompt = z.object({
  /** `null` for events that carry no prompt id. */
  promptId: z.string().nullable(),
  startedAt: z.number(),
  endedAt: z.number(),
  costUsd: z.number(),
  /** Sum of the permission waits of the prompt. */
  waitMs: z.number(),
  items: z.array(TelemetryItem),
});
export type TelemetryPrompt = z.infer<typeof TelemetryPrompt>;

export const TelemetrySession = z.object({ prompts: z.array(TelemetryPrompt) });
export type TelemetrySession = z.infer<typeof TelemetrySession>;

export const SlowTool = z.object({
  toolName: z.string(),
  calls: z.number().int(),
  avgMs: z.number(),
  maxMs: z.number(),
});
export type SlowTool = z.infer<typeof SlowTool>;

/** Per project: the time spent waiting for a person's permission and the slowest tools. */
export const TelemetrySummary = z.object({
  projects: z.array(
    z.object({ projectKey: z.string(), waitMs: z.number(), slowest: z.array(SlowTool) }),
  ),
});
export type TelemetrySummary = z.infer<typeof TelemetrySummary>;

/** Phase 23: whether Flightdeck's exporter keys are in the user's settings.json. */
export const TelemetryOptInStatus = z.object({
  /** `conflict`: settings.json already has an exporter of the user's, so install would refuse. */
  status: z.enum(["installed", "absent", "outdated", "conflict"]),
  /** The settings.json the keys go to. */
  settingsPath: z.string(),
  /** The receiver the keys point at; `null` when no fixed port is set. */
  receiverUrl: z.string().nullable(),
  /** The user's own keys that block an install. */
  conflicts: z.array(z.string()),
});
export type TelemetryOptInStatus = z.infer<typeof TelemetryOptInStatus>;

/** The telemetry commands; index.ts spreads them into `Command`. */
export const telemetryCommands = [
  // Phase 23: the timing of a terminal session, from Claude Code's OTLP telemetry.
  cmd("telemetry.session", z.object({ claudeSessionId: z.string() })),
  cmd("telemetry.summary", z.object({}).strict()),
  cmd("telemetry.status", z.object({}).strict()),
  cmd("telemetry.install", z.object({ confirm: z.boolean().optional() })),
  cmd("telemetry.uninstall", z.object({ confirm: z.boolean().optional() })),
] as const;

/** The `data` of each telemetry command's ack; `CommandResults` extends it. */
export interface TelemetryResults {
  "telemetry.session": TelemetrySession;
  "telemetry.summary": TelemetrySummary;
  "telemetry.status": TelemetryOptInStatus;
  "telemetry.install": TelemetryOptInStatus;
  "telemetry.uninstall": TelemetryOptInStatus;
}
