import type { UsageSummary } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { Panel } from "@/components/layout/panel";
import { useT } from "@/i18n/context";
import type { AppStore } from "../lib/app-store.ts";
import { periodRange, usd } from "../lib/costs.ts";

interface Row {
  day: string;
  projectKey: string;
  costUsd: number;
  tokens: string;
  turns: string | null;
}

/**
 * The host's last 7 days, by day and project: from phase 8 on, the estimated cost of every
 * session read from the transcripts (`costs.summary`); before it, what the SDK reported for the
 * managed sessions (`usage.summary`).
 */
export function UsagePanel(props: {
  store: AppStore;
  hostId: string;
  online: boolean;
  costs: boolean;
}) {
  const t = useT();
  const { store, hostId, online, costs } = props;
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!online) return;
    if (costs) {
      void store
        .hostCommand(hostId, "costs.summary", periodRange("7d", store.today()))
        .then((summary) =>
          setRows(
            (summary?.byDay ?? [])
              .map((r) => ({ ...r, tokens: String(r.tokens), turns: null }))
              .sort((a, b) => b.day.localeCompare(a.day)),
          ),
        );
      return;
    }
    void store
      .hostCommand(hostId, "usage.summary", { days: 7 })
      .then((usage: UsageSummary | null) =>
        setRows(
          (usage?.rows ?? []).map((r) => ({
            ...r,
            tokens: `${r.inputTokens} / ${r.outputTokens}`,
            turns: t("usageUi.turnCount", { n: r.turns }),
          })),
        ),
      );
  }, [store, hostId, online, costs, t]);

  return (
    <section aria-label={t("usageUi.title")}>
      <Panel title={t("usageUi.title")}>
        <p className="text-muted-foreground text-xs">
          {costs ? t("usageUi.allSessions") : t("usageUi.managedOnly")}
        </p>
        {rows?.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("usageUi.empty")}</p>
        )}
        {rows && rows.length > 0 && (
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="text-muted-foreground text-xs">
              <tr>
                <th className="py-1 font-medium">{t("usageUi.day")}</th>
                <th className="py-1 font-medium">{t("usageUi.project")}</th>
                <th className="py-1 pl-4 text-right font-medium">{t("usageUi.cost")}</th>
                <th className="py-1 pl-4 text-right font-medium">{t("usageUi.tokens")}</th>
                {!costs && (
                  <th className="py-1 pl-4 text-right font-medium">{t("usageUi.turns")}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.day}/${row.projectKey}`} className="border-t">
                  <td className="py-1">{row.day}</td>
                  <td className="py-1">{row.projectKey}</td>
                  <td className="py-1 pl-4 text-right">{usd(row.costUsd)}</td>
                  <td className="py-1 pl-4 text-right">{row.tokens}</td>
                  {row.turns !== null && <td className="py-1 pl-4 text-right">{row.turns}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </section>
  );
}
