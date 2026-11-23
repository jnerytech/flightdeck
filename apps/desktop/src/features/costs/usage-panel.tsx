import type { UsageSummary } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { useFormatNumber, useT } from "@/i18n/context";
import { ErrorState, LoadingState, Panel } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { periodRange, usd } from "./domain/costs.ts";
import { groupByProject, type UsageHistoryTarget } from "./domain/usage-rows.ts";
import { UsageGroupRows } from "./usage-group.tsx";

/** What the host answered: nothing yet, a refusal, or the rows (none is an answer too). */
type Load = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; rows: Row[] };

interface Row {
  day: string;
  projectKey: string;
  costUsd: number;
  /** The day's tokens, or the SDK-era input and output pair. */
  tokens: number | [input: number, output: number];
  turns: string | null;
}

/**
 * The host's last 7 days, by day and project: from phase 8 on, the estimated cost of every
 * session read from the transcripts (`costs.summary`); before it, what the SDK reported for the
 * managed sessions (`usage.summary`).
 */
export function UsagePanel(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    online: boolean;
    costs: boolean;
    /** A row was clicked: the history of its folder (when it has one) on that day. */
    onOpenHistory?(filter: UsageHistoryTarget): void;
  }>,
) {
  const t = useT();
  const number = useFormatNumber();
  const { store, hostId, online, costs, onOpenHistory } = props;
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only re-runs the read (Try again).
  useEffect(() => {
    if (!online) return;
    // A host change or a retry starts from loading: the previous host's rows never show under this one.
    setLoad({ kind: "loading" });
    let current = true;
    const request: Promise<Row[] | undefined> = costs
      ? store
          .hostCommand(hostId, "costs.summary", periodRange("7d", store.today()))
          .then((summary) =>
            summary?.byDay
              .map((r) => ({ ...r, turns: null }))
              .sort((a, b) => b.day.localeCompare(a.day)),
          )
      : store.hostCommand(hostId, "usage.summary", { days: 7 }).then((usage: UsageSummary | null) =>
          usage?.rows.map((r) => ({
            ...r,
            tokens: [r.inputTokens, r.outputTokens] as [number, number],
            turns: t("usageUi.turnCount", { n: r.turns }),
          })),
        );
    void request.then((rows) => {
      if (current) setLoad(rows ? { kind: "ready", rows } : { kind: "failed" });
    });
    return () => {
      current = false;
    };
  }, [store, hostId, online, costs, t, attempt]);
  const rows = load.kind === "ready" ? load.rows : null;

  return (
    <section aria-label={t("usageUi.title")}>
      <Panel title={t("usageUi.title")}>
        <p className="text-muted-foreground text-xs">
          {costs ? t("usageUi.allSessions") : t("usageUi.managedOnly")}
        </p>
        {!online && <p className="text-muted-foreground text-sm">{t("usageUi.offline")}</p>}
        {online && load.kind === "loading" && <LoadingState label={t("usageUi.loading")} />}
        {online && load.kind === "failed" && (
          <ErrorState
            message={t("usageUi.failed")}
            retryLabel={t("usageUi.retry")}
            onRetry={() => setAttempt((n) => n + 1)}
          />
        )}
        {online && rows?.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("usageUi.empty")}</p>
        )}
        {online && rows && rows.length > 0 && (
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="text-muted-foreground text-xs">
              <tr>
                <th className="py-1 font-medium">{t("usageUi.day")}</th>
                <th className="py-1 pl-4 text-right font-medium">{t("usageUi.cost")}</th>
                <th className="py-1 pl-4 text-right font-medium">{t("usageUi.tokens")}</th>
                {!costs && (
                  <th className="py-1 pl-4 text-right font-medium">{t("usageUi.turns")}</th>
                )}
              </tr>
            </thead>
            {groupByProject(rows).map((group) => (
              <UsageGroupRows
                key={group.projectKey}
                group={group}
                columns={costs ? 3 : 4}
                total={usd(group.costUsd, t.lang)}
                format={{ cost: (value) => usd(value, t.lang), number }}
                onOpenHistory={onOpenHistory}
              />
            ))}
          </table>
        )}
      </Panel>
    </section>
  );
}
