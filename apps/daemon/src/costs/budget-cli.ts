/**
 * Issue #3460: `flightdeckd budget list|set|set-quota|remove`, the cost limits of a host from a terminal.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, json, runOnLocalDaemon, said } from "../daemon-client/index.ts";
import {
  type BudgetCliArgs,
  budgetLine,
  budgetLines,
  UNSURE_BUDGET,
} from "./domain/budget-cli-view.ts";

export type { BudgetCliArgs } from "./domain/budget-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

/** What a budget is scoped to: the host, or one project by its key. */
const scopeOf = (args: BudgetCliArgs) => ({
  scope: args.scope ?? "host",
  ...(args.projectKey === undefined ? {} : { projectKey: args.projectKey }),
});

export async function runBudgetCli(
  args: BudgetCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-budget",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon, note) => {
      if (args.action === "list") {
        const { budgets } = await daemon.call("budget.list", {});
        return args.json ? json({ budgets }) : said(...budgetLines(budgets));
      }
      note.wrote = true;
      if (args.action === "remove") {
        const id = args.id ?? "";
        await daemon.call("budget.remove", { id });
        return args.json ? json({ removed: id }) : said(`budget ${id} removed`);
      }
      const common = {
        ...(args.id === undefined ? {} : { id: args.id }),
        ...scopeOf(args),
      };
      const made =
        args.action === "set"
          ? await daemon.call("budget.set", {
              ...common,
              period: args.period ?? "day",
              limitUsd: args.limitUsd ?? 0,
              action: args.budgetAction ?? "notify",
            })
          : await daemon.call("budget.setQuota", {
              ...common,
              window: args.window ?? "five_hour",
              limitPct: args.limitPct ?? 0,
              action: args.budgetAction ?? "notify",
            });
      return args.json ? json(made) : said(budgetLine(made));
    },
    ...(args.action === "list" ? {} : { unsure: UNSURE_BUDGET }),
  });
}
