import type { CostsFilter, CostsSummary } from "@flightdeck/protocol";
import { byCodeUnit } from "@flightdeck/protocol";
import { z } from "zod";
import {
  ALL_CLIENTS,
  type Client,
  type ClientScope,
  costByClient,
  loadCostsSummary,
} from "@/features/clients/index.ts";
import { readStored, validValues } from "@/shared/lib/index.ts";
import type { T } from "../../i18n/index.ts";
import {
  CLIENT_BUDGET_ALERTS_KEY,
  type ClientBudgetState,
  evaluateClientBudgets,
} from "./domain/client-budgets.ts";
import { usd } from "./domain/costs.ts";

const Announced = validValues(z.array(z.number()));

/** The clients' limits are looked at this often, besides when one changes or a host comes online. */
export const CLIENT_BUDGET_INTERVAL_MS = 10 * 60_000;

/** The client budgets' part of the app's state (#1596): each limited client's month so far. */
export interface ClientBudgetsSliceState {
  /** Each limited client's month: what it spent against its limit, and the thresholds reached. */
  clientBudgets: ClientBudgetState[];
}

/** A fresh initial state for each store: its array is never shared between stores. */
export const initialClientBudgetsState = (): ClientBudgetsSliceState => ({ clientBudgets: [] });

/** What the client budgets read and ask through the app's store. */
export interface ClientBudgetsCore {
  state(): ClientBudgetsSliceState;
  update(patch: Partial<ClientBudgetsSliceState>): void;
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  /** The month limit of each client that has one, in dollars, by client id. */
  limits(): Record<string, number>;
  /** The online hosts that keep costs. */
  hostsWithCosts(): string[];
  today(): string;
  scope(): ClientScope;
  clients(): Client[];
  /** A host's costs for the days given; null when it cannot answer. */
  summary(hostId: string, filter: CostsFilter): Promise<CostsSummary | null>;
  /** The webhook event of a threshold crossed. */
  feed(name: string, clientId: string, percent: number, limit: string): void;
  /** The OS notification and the bell entry, which opens the client's costs. */
  notify(notification: { title: string; body: string }, clientId: string): void;
  t(): T;
}

/** What each client spent this month against its limit (phase 9; #1596: a slice of the store). */
export class ClientBudgetsSlice {
  private running: Promise<void> | null = null;
  private again = false;
  private seen: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** The hosts with costs that were online at the last look at the clients' limits. */
  private hosts = "";

  constructor(private readonly core: ClientBudgetsCore) {
    this.seen = JSON.stringify(core.limits());
  }

  /** The limits are looked at every few minutes while the app runs. */
  start(intervalMs: number = CLIENT_BUDGET_INTERVAL_MS): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => void this.check(), intervalMs);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** A limit that was set, changed or cleared is looked at now, not at the next round. */
  onLimitsChanged(): void {
    const limits = JSON.stringify(this.core.limits());
    if (limits === this.seen) return;
    this.seen = limits;
    void this.check();
  }

  /** A host with costs that came online (or left) is a reason to look at the limits again. */
  onHostsChanged(): void {
    const online = this.core.hostsWithCosts().sort(byCodeUnit).join("|");
    if (online === this.hosts) return;
    this.hosts = online;
    if (online) void this.check();
  }

  /**
   * Looks at what each client spent this month, across hosts, against its limit: the thresholds
   * crossed for the first time notify, and the crossed budgets join "Needs you". Looks asked
   * while one runs make it look once more when it ends, never twice at the same time.
   */
  async check(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    const run = async () => {
      do {
        this.again = false;
        await this.look(); // NOSONAR: sequential by design: each pass needs the answer of the one before
      } while (this.again);
    };
    this.running = run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async look(): Promise<void> {
    const limits = this.core.limits();
    if (Object.keys(limits).length === 0) {
      if (this.core.state().clientBudgets.length > 0) this.core.update({ clientBudgets: [] });
      return;
    }
    const hostIds = this.core.hostsWithCosts();
    if (hostIds.length === 0) return;
    const today = this.core.today();
    const month = today.slice(0, 7);
    const scope = this.core.scope();
    const loaded = await loadCostsSummary({
      hostIds,
      filter: { from: `${month}-01`, to: today },
      selection: ALL_CLIENTS,
      scope,
      ask: (id, filter) => this.core.summary(id, filter),
    });
    const spent = Object.fromEntries(
      costByClient(loaded.summary, scope, this.core.clients(), "").map((row) => [
        row.clientId,
        row.costUsd,
      ]),
    );
    const evaluation = evaluateClientBudgets({
      month,
      limits,
      spent,
      announced: this.announced(),
    });
    this.core.storage.setItem(CLIENT_BUDGET_ALERTS_KEY, JSON.stringify(evaluation.announced));
    this.core.update({ clientBudgets: evaluation.states });
    const t = this.core.t();
    for (const { clientId, threshold } of evaluation.news) {
      const state = evaluation.states.find((s) => s.clientId === clientId);
      const name = this.core.clients().find((c) => c.id === clientId)?.name ?? clientId;
      const percent = Math.round(threshold * 100);
      const limit = usd(state?.limitUsd ?? 0, t.lang);
      this.core.feed(name, clientId, percent, limit);
      this.core.notify(
        {
          title: t("messages.budgetTitle"),
          body: t("clients.budgetAlert", { name, percent, limit }),
        },
        clientId,
      );
    }
  }

  /** The thresholds announced before; a client whose entry is not a list of numbers has none. */
  private announced(): Record<string, number[]> {
    return readStored(this.core.storage, CLIENT_BUDGET_ALERTS_KEY, Announced, {});
  }
}
