/**
 * Issue #3460: what `flightdeckd costs` and `flightdeckd roi` take, checked before anything is sent.
 * The parser in `args.ts` adds the usage text to the problem this names.
 */
import { UsageOrigin } from "@flightdeck/protocol";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { USAGE } from "./usage.ts";

/** The parsed arguments this check reads: `CliArgs` fits it. */
export interface CostsArgs {
  command: string;
  action?: string;
  from?: string;
  until?: string;
  project?: string;
  model?: string;
  origin?: string;
  confirm?: boolean;
  costsIds?: string[];
  host?: string;
}

/** The most sessions `costs sessions` asks for at once: the daemon's own limit (`costs.sessions`). */
const MAX_SESSIONS = 500;

/** `costs <verb>`: the verb, and the id of the session, card or run it names (`sessions` takes several). */
export function readCosts(args: CliArgs, reader: ArgReader): void {
  args.command = "costs";
  const verbs = [
    "summary",
    "session",
    "sessions",
    "card",
    "run",
    "status",
    "export",
    "reprice",
  ] as const;
  const action = subAction(reader, verbs, "invalid costs action");
  args.action = action;
  if (action === "session") args.costsId = operand(reader, "the session");
  if (action === "sessions") readCostsIds(args, reader);
  if (action === "card") args.costsId = operand(reader, "the card");
  if (action === "run") args.costsId = operand(reader, "the run");
}

/** `costs sessions <id>...`: every word up to the first flag is a Claude session id, and at least one is needed. */
function readCostsIds(args: CliArgs, reader: ArgReader): void {
  args.costsIds = [];
  while (reader.peek() !== undefined && !(reader.peek() ?? "").startsWith("--"))
    args.costsIds.push(reader.next() ?? "");
  if (args.costsIds.length === 0)
    throw new Error(`costs sessions: missing the id of a session\n${USAGE}`);
}

/** `--host` belongs to `costs sessions` alone, and that verb asks for at most 500 sessions. */
function sessionsProblem(args: CostsArgs): string | undefined {
  const sessions = args.command === "costs" && args.action === "sessions";
  if (args.host !== undefined && !sessions)
    return "--host: this flag only applies to flightdeckd costs sessions";
  const count = args.costsIds?.length ?? 0;
  if (sessions && count > MAX_SESSIONS)
    return `costs sessions: at most ${MAX_SESSIONS} sessions at a time, ${count} given`;
  return undefined;
}

/** The sources a message's usage can come from, as `--origin` names them. */
const ORIGINS: readonly string[] = UsageOrigin.options;

/** A day as `YYYY-MM-DD` that exists on the calendar (`2026-02-30` does not). */
function isDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year = 0, month = 0, day = 0] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** `costs summary` and `costs export` take days and filters; `roi` takes days and a project. */
const takesPeriod = (args: CostsArgs) =>
  (args.command === "costs" && (args.action === "summary" || args.action === "export")) ||
  args.command === "roi";

/** The days of `costs summary|export` and `roi`: both there, each a day, in order, and a known origin. */
function periodProblem(args: CostsArgs): string | undefined {
  if (args.from === undefined || args.until === undefined)
    return "missing --from and --to: the first and the last day, as YYYY-MM-DD";
  if (!isDay(args.from)) return "--from needs a day as YYYY-MM-DD";
  if (!isDay(args.until)) return "--to needs a day as YYYY-MM-DD";
  if (args.from > args.until) return "--from is after --to";
  if (args.origin !== undefined && !ORIGINS.includes(args.origin))
    return `--origin: ${ORIGINS.join(", ")}`;
  return undefined;
}

/** `--confirm` belongs to `costs reprice` alone, and `reprice` cannot run without it. */
function confirmProblem(args: CostsArgs): string | undefined {
  const reprice = args.command === "costs" && args.action === "reprice";
  if (args.confirm !== undefined && !reprice)
    return "--confirm: this flag only applies to flightdeckd costs reprice";
  if (reprice && args.confirm === undefined)
    return "costs reprice rewrites the cost of every entry: pass --confirm to do it";
  return undefined;
}

/** `--to` and `--from` belong to the verbs that take a period. */
function periodFlagProblem(args: CostsArgs): string | undefined {
  if (args.until !== undefined && !takesPeriod(args))
    return "--to: this flag only applies to flightdeckd costs summary, export and roi";
  if (args.command === "costs" && args.from !== undefined && !takesPeriod(args))
    return "--from: this flag only applies to flightdeckd costs summary, export and roi";
  return undefined;
}

/** `--origin`, `--model` and `--project` belong to `costs summary` and `costs export`. */
function filterFlagProblem(args: CostsArgs): string | undefined {
  const costs = args.command === "costs";
  const filters = costs && (args.action === "summary" || args.action === "export");
  if (args.origin !== undefined && !filters)
    return "--origin: this flag only applies to flightdeckd costs summary and export";
  if (args.model !== undefined && (costs || args.command === "roi") && !filters)
    return "--model: this flag only applies to flightdeckd costs summary and export";
  if (costs && !filters && args.project !== undefined)
    return "--project: this flag only applies to flightdeckd costs summary and export";
  return undefined;
}

/** What is wrong with the flags of `costs` and `roi`: a day that is not one, a missing day, a flag of another verb. */
export function costsProblem(args: CostsArgs): string | undefined {
  // `--to`, `--from` and `--origin` are `history`'s and `update`'s flags too: those commands are checked elsewhere.
  if (args.command !== "costs" && args.command !== "roi") return undefined;
  const stray =
    confirmProblem(args) ??
    periodFlagProblem(args) ??
    filterFlagProblem(args) ??
    sessionsProblem(args);
  if (stray !== undefined) return stray;
  return takesPeriod(args) ? periodProblem(args) : undefined;
}
