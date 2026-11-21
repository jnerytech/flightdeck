/**
 * Issue #3736: `flightdeckd logs tail`, `releases list`, `alert list` and `activity since`, the host's log, the
 * app's releases, a project's repository alerts and what happened on a host since a time, from a shell. The
 * parser in `args.ts` reads the words after the noun here and this file checks the flags, with the usage text
 * added there; `--json` and `--host` are checked there with the other commands'. `--lines` is also `review add`'s
 * and `--limit` is shared with other commands: on these nouns they take the range the daemon takes.
 */
import type { ActivityCliArgs } from "../../activity/index.ts";
import type { AlertCliArgs } from "../../github/index.ts";
import type { LogsCliArgs } from "../../logs/index.ts";
import type { ReleasesCliArgs } from "../../releases/index.ts";
import { type ArgReader, invalid, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import type { Handler } from "./flag-handlers.ts";
import { wholeFrom } from "./quota-args.ts";
import { REVIEW_FLAGS } from "./review-args.ts";

/** The most lines of the log, releases and items of each list the daemon gives in one answer. */
const MOST_LINES = 500;
const MOST_RELEASES = 20;
const MOST_ACTIVITY = 50;

/** An ISO date and time with its zone, as the daemon takes it: `2026-11-20T09:00:00Z`, with seconds and a zone offset optional. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function readLogs(args: CliArgs, reader: ArgReader): void {
  args.command = "logs";
  args.action = subAction(reader, ["tail"] as const, "invalid logs action");
}

export function readReleases(args: CliArgs, reader: ArgReader): void {
  args.command = "releases";
  args.action = subAction(reader, ["list"] as const, "invalid releases action");
}

/** `alert list <project>`: the project is its id or its name. */
export function readAlert(args: CliArgs, reader: ArgReader): void {
  args.command = "alert";
  args.action = subAction(reader, ["list"] as const, "invalid alert action");
  args.alertProject = operand(reader, "the project");
}

/** `activity since <time>`: the instant is sent as UTC, whatever zone the person typed it in. */
export function readActivity(args: CliArgs, reader: ArgReader): void {
  args.command = "activity";
  args.action = subAction(reader, ["since"] as const, "invalid activity action");
  const time = operand(reader, "the time");
  const instant = ISO_TIME.test(time) ? new Date(time) : new Date(Number.NaN);
  if (Number.isNaN(instant.getTime()))
    throw invalid(
      "activity since: the time must be an ISO date and time (2026-11-20T09:00:00Z)",
      time,
    );
  args.activitySince = instant.toISOString();
}

/** `--lines` is a range of the diff on `review add` and a count of log lines on `logs tail`. */
export const LINES_FLAG: Handler = (args, reader, value) => {
  if (args.command === "logs") args.logLines = wholeFrom("--lines", value(), MOST_LINES);
  else REVIEW_FLAGS["--lines"]?.(args, reader, value);
};

/** The most a `--limit` takes on `releases list` and `activity since`; the other commands keep theirs. */
export function feedLimitMax(command: string): number | undefined {
  if (command === "releases") return MOST_RELEASES;
  if (command === "activity") return MOST_ACTIVITY;
  return undefined;
}

/** What is wrong with the flags of these nouns: a `--limit` on the two that list the whole answer. */
export function feedProblem(args: CliArgs): string | undefined {
  if (args.limit !== undefined && (args.command === "logs" || args.command === "alert"))
    return "--limit: this flag only applies to flightdeckd releases list and activity since";
  return undefined;
}

export const logsCliArgs = (args: CliArgs): LogsCliArgs => ({
  ...(args.logLines === undefined ? {} : { lines: args.logLines }),
  ...(args.json ? { json: true } : {}),
});

export const releasesCliArgs = (args: CliArgs): ReleasesCliArgs => ({
  ...(args.limit === undefined ? {} : { limit: args.limit }),
  ...(args.json ? { json: true } : {}),
});

export const alertCliArgs = (args: CliArgs): AlertCliArgs => ({
  project: args.alertProject ?? "",
  ...(args.json ? { json: true } : {}),
});

export const activityCliArgs = (args: CliArgs): ActivityCliArgs => ({
  since: args.activitySince ?? "",
  ...(args.limit === undefined ? {} : { limit: args.limit }),
  ...(args.json ? { json: true } : {}),
});
