import type {
  Budget,
  BudgetInput,
  BudgetUpdated,
  CommandResults,
  QuotaBudgetInput,
} from "@flightdeck/protocol";
import type { T } from "../../i18n/index.ts";
import { budgetLabel, budgetLimitText, estimateNote, share } from "./domain/budgets.ts";
import { usd } from "./domain/costs.ts";

/** The budgets' part of the app's state (#1596): each host's own, kept by `budget.updated`. */
export interface BudgetsSliceState {
  /** Budgets of each host, by host id; kept by `budget.updated` (phase 8). */
  budgets: Record<string, Budget[]>;
}

/** A fresh initial state for each store: its record is never shared between stores. */
export const initialBudgetsState = (): BudgetsSliceState => ({ budgets: {} });

/** What the budgets read and ask through the app's store. */
export interface BudgetsCore {
  state(): BudgetsSliceState;
  update(patch: Partial<BudgetsSliceState>): void;
  /** Creates or changes a host's budget; null when it refuses (the toast says why). */
  set(hostId: string, input: BudgetInput): Promise<Budget | null>;
  /** The same for a budget in terms of a plan quota window. */
  setQuota(hostId: string, input: QuotaBudgetInput): Promise<Budget | null>;
  /** Removes a host's budget; null when it refuses. */
  remove(hostId: string, id: string): Promise<CommandResults["budget.remove"] | null>;
  /** The host's name, or undefined when the app does not list it. */
  hostName(hostId: string): string | undefined;
  /** The webhook feed's line for a crossed threshold. */
  feed(host: { id: string; name: string }, label: string, percent: number, limit: string): void;
  /** The OS notification and the bell entry, opening the costs screen of the host. */
  notify(
    notification: { title: string; body: string },
    route: { name: "costs"; host: string; projectKey?: string },
    source: { event: "budget-quota"; hostId: string },
  ): void;
  t(): T;
}

/** The spending limits of each host (phase 8; #1596: a slice of the store). */
export class BudgetsSlice {
  constructor(private readonly core: BudgetsCore) {}

  /** Creates a budget or changes the one with `input.id`; the list follows the answer. */
  async set(hostId: string, input: BudgetInput): Promise<void> {
    const budget = await this.core.set(hostId, input);
    if (budget) this.keep(hostId, budget, false);
  }

  /** The same for a budget in terms of a plan quota window (issue #1248). */
  async setQuota(hostId: string, input: QuotaBudgetInput): Promise<void> {
    const budget = await this.core.setQuota(hostId, input);
    if (budget) this.keep(hostId, budget, false);
  }

  async remove(hostId: string, budget: Budget): Promise<void> {
    const removed = await this.core.remove(hostId, budget.id);
    if (removed !== null) this.keep(hostId, budget, true);
  }

  /** Keeps a host's whole list, as it answered when it connected. */
  replace(hostId: string, budgets: Budget[]): void {
    this.core.update({ budgets: { ...this.core.state().budgets, [hostId]: budgets } });
  }

  /** A crossed threshold notifies (the daemon sends each one once per period). */
  onUpdated(hostId: string, update: BudgetUpdated): void {
    this.keep(hostId, update.budget, update.removed);
    const name = this.core.hostName(hostId);
    if (update.threshold === null || name === undefined) return;
    const t = this.core.t();
    const percent = Math.round(update.threshold * 100);
    const label = budgetLabel(update.budget, t);
    this.core.feed({ id: hostId, name }, label, percent, budgetLimitText(update.budget, t));
    const window = update.budget.limitPct !== null;
    this.core.notify(
      {
        title: t("messages.budgetTitle"),
        body: t(window ? "messages.budgetBodyQuota" : "messages.budgetBody", {
          host: name,
          label,
          percent,
          limit: window
            ? share(update.budget.limitPct ?? 0, t.lang)
            : usd(update.budget.limitUsd, t.lang),
          estimate: estimateNote(update.budget, t),
        }),
      },
      {
        name: "costs",
        host: hostId,
        ...(update.budget.projectKey ? { projectKey: update.budget.projectKey } : {}),
      },
      { event: "budget-quota", hostId },
    );
  }

  private keep(hostId: string, budget: Budget, removed: boolean): void {
    const others = (this.core.state().budgets[hostId] ?? []).filter((b) => b.id !== budget.id);
    const list = removed
      ? others
      : [...others, budget].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    this.core.update({ budgets: { ...this.core.state().budgets, [hostId]: list } });
  }
}
