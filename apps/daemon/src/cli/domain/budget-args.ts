/**
 * Issue #3460: what `flightdeckd budget` takes, checked before anything is sent: the value of each
 * flag as the parser reads it, and which flags go with which verb. The parser in `args.ts` adds the
 * usage text to the problem this names.
 */
import type { CliArgs } from "./cli-args.ts";
import { parseShare } from "./quota-args.ts";
import { USAGE } from "./usage.ts";

/** The parsed arguments this check reads: `CliArgs` fits it. */
export interface BudgetArgs {
  command: string;
  action?: string;
  scope?: string;
  project?: string;
  budgetId?: string;
  budgetPeriod?: string;
  budgetWindow?: string;
  limitUsd?: number;
  limitPct?: number;
  budgetAction?: string;
}

type FlagHandler = (args: CliArgs, _reader: unknown, value: () => string) => void;

const refused = (message: string) => new Error(`${message}\n${USAGE}`);

/** A flag whose value is one of `allowed`. */
const oneOf =
  <T extends string>(
    flag: string,
    allowed: readonly T[],
    set: (args: CliArgs, value: T) => void,
  ): FlagHandler =>
  (args, _reader, value) => {
    const given = value();
    if (!(allowed as readonly string[]).includes(given))
      throw refused(`${flag}: ${allowed.join(" or ")}`);
    set(args, given as T);
  };

/** The flags of `budget` that take a value, for the parser's table of flags. */
export const BUDGET_FLAGS: Record<string, FlagHandler> = {
  "--period": oneOf("--period", ["day", "month"], (args, v) => {
    args.budgetPeriod = v;
  }),
  "--window": oneOf("--window", ["five_hour", "seven_day"], (args, v) => {
    args.budgetWindow = v;
  }),
  "--action": oneOf("--action", ["notify", "queue"], (args, v) => {
    args.budgetAction = v;
  }),
  // Plain decimal digits: `Number` would take `0x5`, `1e3` and a padded " 5 ".
  "--limit-usd": (args, _reader, value) => {
    const text = value();
    const usd = /^\d+(\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
    // A cent is the least the list can show.
    if (!Number.isFinite(usd) || usd < 0.01) throw refused("--limit-usd: a positive amount");
    args.limitUsd = usd;
  },
  "--limit-pct": (args, _reader, value) => {
    const share = parseShare(value());
    if (share === null || share === undefined || share < 0.001)
      throw refused("--limit-pct: a share from 0.001 to 1");
    args.limitPct = share;
  },
  // `budget remove` takes the id as its operand, so a flag beside it names two budgets.
  "--id": (args, _reader, value) => {
    if (args.command === "budget" && args.action === "remove")
      throw refused("--id: this flag only applies to flightdeckd budget set and set-quota");
    const id = value();
    // An empty id would reach the daemon as "no id" and make a new budget instead of changing one.
    if (id.trim() === "") throw refused("--id: a budget id");
    args.budgetId = id;
  },
};

/** The flags that belong to the verbs of `budget` only, each with the verbs that take it. */
function budgetFlags(args: BudgetArgs): Array<[string, unknown, readonly string[], string]> {
  const both = ["set", "set-quota"];
  return [
    ["--scope", args.scope, both, "set and set-quota"],
    ["--project", args.project, both, "set and set-quota"],
    ["--action", args.budgetAction, both, "set and set-quota"],
    ["--period", args.budgetPeriod, ["set"], "set"],
    ["--limit-usd", args.limitUsd, ["set"], "set"],
    ["--window", args.budgetWindow, ["set-quota"], "set-quota"],
    ["--limit-pct", args.limitPct, ["set-quota"], "set-quota"],
  ];
}

/** What is wrong with the flags of `budget`: a flag of another verb, or one the verb cannot do without. */
export function budgetProblem(args: BudgetArgs): string | undefined {
  const budget = args.command === "budget";
  for (const [flag, value, verbs, text] of budgetFlags(args)) {
    if (value === undefined) continue;
    // `--scope` is `persona`'s and `--project` the board's: only `budget` is checked here.
    if (!budget && ["--scope", "--project"].includes(flag)) continue;
    if (!budget || !verbs.includes(args.action as string))
      return `${flag}: this flag only applies to flightdeckd budget ${text}`;
  }
  if (args.budgetId !== undefined && !(budget && args.action !== "list" && args.action !== "watch"))
    return "--id: this flag only applies to flightdeckd budget set and set-quota";
  if (!budget || (args.action !== "set" && args.action !== "set-quota")) return undefined;
  if (args.scope === undefined) return "missing --scope";
  if (args.scope === "all") return "--scope: host or project";
  if (args.scope === "project" && args.project === undefined)
    return "--scope project needs --project";
  if (args.scope === "host" && args.project !== undefined)
    return "--project: only with --scope project";
  if (args.action === "set") {
    if (args.budgetPeriod === undefined) return "missing --period";
    if (args.limitUsd === undefined) return "missing --limit-usd";
  } else {
    if (args.budgetWindow === undefined) return "missing --window";
    if (args.limitPct === undefined) return "missing --limit-pct";
  }
  if (args.budgetAction === undefined) return "missing --action";
  return undefined;
}
