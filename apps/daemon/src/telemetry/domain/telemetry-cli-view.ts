/** Issue #3755: how `flightdeckd telemetry session|summary` print the timing the daemon holds. */
import type {
  TelemetryItem,
  TelemetryPrompt,
  TelemetrySession,
  TelemetrySummary,
} from "@flightdeck/protocol";

const iso = (at: number) => new Date(at).toISOString();
const ms = (value: number) => `${Math.round(value)} ms`;
const dollars = (value: number) => `$${value.toFixed(4)}`;

const successWord = (success: boolean | null): string | null =>
  success === null ? null : success ? "ok" : "failed";

const decisionText = (decision: string | null, source: string | null): string | null =>
  decision === null || source === null ? decision : `${decision} by ${source}`;

/** One line per step: what it was, when, and each part the step has, in the order the app's timeline shows them. */
function itemLine(item: TelemetryItem): string {
  const parts = [
    item.kind,
    iso(item.at),
    item.toolName,
    item.durationMs === null ? null : ms(item.durationMs),
    item.costUsd === null ? null : dollars(item.costUsd),
    successWord(item.success),
    item.error === null ? null : `error ${item.error}`,
    decisionText(item.decision, item.source),
    item.waitMs === null ? null : `waited ${ms(item.waitMs)}`,
  ];
  return `  ${parts.filter((part) => part !== null).join("  ")}`;
}

const promptLines = (prompt: TelemetryPrompt): string[] => [
  `prompt ${prompt.promptId ?? "none"}  ${iso(prompt.startedAt)} to ${iso(prompt.endedAt)}  ${dollars(prompt.costUsd)}  permission wait ${ms(prompt.waitMs)}`,
  ...prompt.items.map(itemLine),
];

/** One block per prompt, with one line per step; no prompt or tool text, which the daemon never holds. */
export const sessionLines = (session: TelemetrySession): string[] =>
  session.prompts.flatMap(promptLines);

/** One block per project: the permission wait and the slowest tools; `no telemetry` when nothing was received. */
export function summaryLines(summary: TelemetrySummary): string[] {
  if (summary.projects.length === 0) return ["no telemetry"];
  return summary.projects.flatMap((project) => [
    `${project.projectKey}  permission wait ${ms(project.waitMs)}`,
    ...project.slowest.map(
      (tool) =>
        `  ${tool.toolName}  ${tool.calls} ${tool.calls === 1 ? "call" : "calls"}  avg ${ms(tool.avgMs)}  max ${ms(tool.maxMs)}`,
    ),
  ]);
}
