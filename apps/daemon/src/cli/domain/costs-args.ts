/**
 * Issue #3460: what `flightdeckd costs` and `flightdeckd roi` take, checked before anything is sent.
 * The parser in `args.ts` adds the usage text to the problem this names.
 */
import { UsageOrigin } from "@flightdeck/protocol";

/** The parsed arguments this check reads: `CliArgs` fits it. */
export interface CostsArgs {
  command: string;
  action?: string;
  from?: string;
  until?: string;
  project?: string;
  model?: string;
  origin?: string;
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

/** What is wrong with the flags of `costs` and `roi`: a day that is not one, a missing day, a flag of another verb. */
export function costsProblem(args: CostsArgs): string | undefined {
  // `--to`, `--from` and `--origin` are `history`'s and `update`'s flags too: those commands are checked elsewhere.
  if (args.command !== "costs" && args.command !== "roi") return undefined;
  const costs = args.command === "costs";
  if (args.until !== undefined && !takesPeriod(args))
    return "--to: this flag only applies to flightdeckd costs summary, export and roi";
  if (costs && args.from !== undefined && !takesPeriod(args))
    return "--from: this flag only applies to flightdeckd costs summary, export and roi";
  const filters = costs && (args.action === "summary" || args.action === "export");
  if (args.origin !== undefined && !filters)
    return "--origin: this flag only applies to flightdeckd costs summary and export";
  if (args.model !== undefined && (costs || args.command === "roi") && !filters)
    return "--model: this flag only applies to flightdeckd costs summary and export";
  if (costs && !filters && args.project !== undefined)
    return "--project: this flag only applies to flightdeckd costs summary and export";
  if (!takesPeriod(args)) return undefined;
  if (args.from === undefined || args.until === undefined)
    return "missing --from and --to: the first and the last day, as YYYY-MM-DD";
  if (!isDay(args.from)) return "--from needs a day as YYYY-MM-DD";
  if (!isDay(args.until)) return "--to needs a day as YYYY-MM-DD";
  if (args.from > args.until) return "--from is after --to";
  if (args.origin !== undefined && !ORIGINS.includes(args.origin))
    return `--origin: ${ORIGINS.join(", ")}`;
  return undefined;
}
