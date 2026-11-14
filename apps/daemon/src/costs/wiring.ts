import type { Database } from "bun:sqlite";
import type { Config } from "../config.ts";
import { type DomainModule, serverGroup } from "../server/index.ts";
import { Budgets, type BudgetsOptions } from "./budgets.ts";
import { Costs } from "./costs.ts";
import { resolvePricing } from "./domain/pricing.ts";
import { UsageIndexer, type UsageIndexerOptions } from "./usage-indexer.ts";

/** What the host's usage and costs are built from. */
export interface CostsDeps {
  db: Database;
  config: Pick<Config, "pricing" | "history">;
  /** The pricing as the config file holds it now, read again for a reprice. */
  readPricing: () => Promise<Config["pricing"]>;
  /** The history folders the usage index leaves out (phase 13's, the daemon's own). */
  excludeCwds: UsageIndexerOptions["excludeCwds"];
  projectKey: UsageIndexerOptions["projectKey"];
  warmKeys: UsageIndexerOptions["warmKeys"];
  quota: BudgetsOptions["quota"];
  log: (message: string) => void;
  /** The history index: what it sees changing is indexed again. */
  history: { onChange(listener: () => void): () => void };
}

/**
 * The usage and costs of every session of the host (phases 8 and 13, issue #1593): the priced
 * costs, the usage index over the transcripts and the budgets judged after each of its passes,
 * started in that order.
 */
export function createCosts(deps: CostsDeps) {
  const { db, config, quota } = deps;
  // Usage of every session of the host, from the transcripts (phase 8): first the ones that
  // already exist, in the background, then whatever the history index sees changing.
  const costs = new Costs({
    db,
    pricing: resolvePricing(config.pricing),
    loadPricing: async () => resolvePricing(await deps.readPricing()),
    initialLoad: () => usageIndex.status(),
  });
  const usageIndex = new UsageIndexer({
    db,
    roots: config.history.roots,
    excludeCwds: deps.excludeCwds,
    projectKey: deps.projectKey,
    warmKeys: deps.warmKeys,
    cost: (tokens) => costs.cost(tokens),
    log: deps.log,
    onPass: () => budgets.evaluate(),
  });
  const budgets = new Budgets({ db, quota });
  budgets.start();
  const offHistory = deps.history.onChange(() => usageIndex.request());
  usageIndex.start();
  const module: DomainModule<"costs"> = {
    server: { costs: serverGroup<"costs">()({ costs, budgets }) },
    stop: async () => {
      // First: a history change must not start a pass on a stopped index (the history stops later).
      offHistory();
      await usageIndex.stop();
      budgets.stop();
    },
    // It stops after the server today (#2094).
    stopPhase: "late",
  };
  return { modules: [module] as const, costs, usageIndex, budgets };
}
