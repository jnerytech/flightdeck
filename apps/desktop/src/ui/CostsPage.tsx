import type { CostsFilter, CostsStatus, CostsSummary, UsageOrigin } from "@flightdeck/protocol";
import { Coins } from "lucide-react";
import { useEffect, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Page } from "@/components/layout/page";
import { Panel } from "@/components/layout/panel";
import { Toolbar } from "@/components/layout/stack";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMinLoading } from "@/hooks/use-min-loading";
import { useT } from "@/i18n/context";
import { cn } from "@/lib/utils";
import type { Key } from "../i18n/index.ts";
import type { AppState, AppStore } from "../lib/app-store.ts";
import {
  daysBetween,
  PERIOD_LABELS,
  type Period,
  periodRange,
  projectLabel,
  usd,
} from "../lib/costs.ts";
import { basename } from "../lib/paths.ts";
import { hasFeature } from "../lib/version.ts";
import { QuotaCharts } from "./QuotaCharts.tsx";

/** A tint of the accent per project in a day's bar, so the stack reads. */
const SEGMENTS = ["bg-brand", "bg-brand/70", "bg-brand/50", "bg-brand/35"];

const ORIGINS: UsageOrigin[] = ["terminal", "app", "card", "workflow", "subagent"];

export type TopSession = CostsSummary["topSessions"][number];

const tokensOf = (t: CostsSummary["totals"]["tokens"]) =>
  t.input + t.output + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;

/** A breakdown as a two-column table. */
function Breakdown(props: { name: string; rows: Array<{ label: string; costUsd: number }> }) {
  return (
    <section aria-label={props.name}>
      <Panel title={props.name}>
        <table className="w-full text-left text-sm tabular-nums">
          <tbody>
            {props.rows.map((row) => (
              <tr key={row.label} className="border-t first:border-t-0">
                <td className="py-1">{row.label}</td>
                <td className="py-1 text-right">{usd(row.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </section>
  );
}

/**
 * Estimated cost of every session of a host (terminal, app, cards and workflows), from the
 * transcripts, in API prices: totals, a daily chart stacked by project, breakdowns, the most
 * expensive sessions and a CSV export.
 */
export function CostsPage(props: {
  store: AppStore;
  state: AppState;
  onOpenSession(hostId: string, session: TopSession): void;
}) {
  const t = useT();
  const { store, state } = props;
  const hosts = state.hosts.filter(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "costs", false),
  );
  /** The host the user picked; until then (or if it left), the first one that announces costs. */
  const [chosen, setChosen] = useState("");
  const hostId = hosts.some((h) => h.id === chosen) ? chosen : (hosts[0]?.id ?? "");
  const [period, setPeriod] = useState<Period>("7d");
  const today = store.today();
  const [range, setRange] = useState(periodRange("7d", today));
  const [filters, setFilters] = useState<Omit<CostsFilter, "from" | "to">>({});
  const [summary, setSummary] = useState<CostsSummary | null>(null);
  /** The period without filters: the filters offer every project and model of it. */
  const [all, setAll] = useState<CostsSummary | null>(null);
  const [status, setStatus] = useState<CostsStatus | null>(null);
  const days = period === "range" ? range : periodRange(period, today);
  const filter: CostsFilter = { ...days, ...filters };
  const key = JSON.stringify([hostId, filter]);
  useEffect(() => {
    if (!hostId) return;
    void store.hostCommand(hostId, "costs.summary", JSON.parse(key)[1]).then(setSummary);
  }, [store, hostId, key]);
  const daysKey = JSON.stringify([hostId, days]);
  useEffect(() => {
    if (!hostId) return;
    void store.hostCommand(hostId, "costs.summary", JSON.parse(daysKey)[1]).then(setAll);
  }, [store, hostId, daysKey]);
  useEffect(() => {
    if (hostId) void store.hostCommand(hostId, "costs.status", {}).then(setStatus);
  }, [store, hostId]);
  const setFilter = (name: keyof typeof filters, value: string) => {
    const { [name]: _old, ...rest } = filters;
    setFilters(value ? { ...rest, [name]: value } : rest);
  };
  const exportCsv = async () => {
    const file = await store.hostCommand(hostId, "costs.export", filter);
    if (file) await store.saveFile(file.filename, file.csv);
  };
  const byDay = summary?.byDay ?? [];
  const dayTotals = new Map<string, number>();
  for (const row of byDay) dayTotals.set(row.day, (dayTotals.get(row.day) ?? 0) + row.costUsd);
  const highest = Math.max(0, ...dayTotals.values());

  const loading = useMinLoading(hostId !== "" && summary === null);
  const empty = summary !== null && summary.totals.costUsd === 0 && summary.byDay.length === 0;
  const select =
    "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <Page
      title={t("costsUi.title")}
      subtitle={t("costsUi.subtitle")}
      toolbar={
        <Toolbar label={t("costsUi.filters")}>
          <select
            aria-label={t("costsUi.host")}
            className={select}
            value={hostId}
            onChange={(e) => setChosen(e.target.value)}
          >
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <Button
              key={p}
              variant="outline"
              size="sm"
              aria-pressed={period === p}
              className="aria-pressed:bg-accent"
              onClick={() => setPeriod(p)}
            >
              {t(`periods.${p}` as Key)}
            </Button>
          ))}
          {period === "range" && (
            <>
              <Input
                type="date"
                aria-label={t("costsUi.from")}
                className="h-8 w-36 text-xs"
                value={range.from}
                onChange={(e) => setRange({ ...range, from: e.target.value })}
              />
              <Input
                type="date"
                aria-label={t("costsUi.to")}
                className="h-8 w-36 text-xs"
                value={range.to}
                onChange={(e) => setRange({ ...range, to: e.target.value })}
              />
            </>
          )}
          <select
            aria-label={t("costsUi.project")}
            className={select}
            value={filters.projectKey ?? ""}
            onChange={(e) => setFilter("projectKey", e.target.value)}
          >
            <option value="">{t("costsUi.allProjects")}</option>
            {(all?.byProject ?? []).map((p) => (
              <option key={p.projectKey} value={p.projectKey}>
                {projectLabel(p.projectKey)}
              </option>
            ))}
          </select>
          <select
            aria-label={t("costsUi.model")}
            className={select}
            value={filters.model ?? ""}
            onChange={(e) => setFilter("model", e.target.value)}
          >
            <option value="">{t("costsUi.allModels")}</option>
            {(all?.byModel ?? []).map((m) => (
              <option key={m.model} value={m.model}>
                {m.model}
              </option>
            ))}
          </select>
          <select
            aria-label={t("costsUi.origin")}
            className={select}
            value={filters.origin ?? ""}
            onChange={(e) => setFilter("origin", e.target.value)}
          >
            <option value="">{t("costsUi.allOrigins")}</option>
            {ORIGINS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => void exportCsv()}>
            {t("costsUi.export")}
          </Button>
        </Toolbar>
      }
    >
      <div className="flex flex-col gap-5">
        {status && status.divergences.length > 0 && (
          <InlineNotice>
            {t("costsUi.divergence", {
              models: status.divergences
                .map((d) =>
                  t("costsUi.divergenceItem", {
                    model: d.model,
                    computed: usd(d.computedUsd),
                    sdk: usd(d.sdkUsd),
                  }),
                )
                .join("; "),
            })}
          </InlineNotice>
        )}
        {hosts.length === 0 && <EmptyState icon={Coins} title={t("costsUi.noHost")} />}
        {loading && <LoadingState label={t("costsUi.loading")} />}
        {empty && (
          <EmptyState
            icon={Coins}
            title={t("costsUi.empty")}
            action={
              period === "today" || period === "7d" ? (
                <Button variant="outline" onClick={() => setPeriod("30d")}>
                  {t("costsUi.emptyAction")}
                </Button>
              ) : undefined
            }
          />
        )}
        {summary && !empty && (
          <>
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3">
              {[
                [t("costsUi.estimated"), usd(summary.totals.costUsd)],
                [t("costsUi.tokens"), String(tokensOf(summary.totals.tokens))],
                [t("costsUi.cacheSavings"), usd(summary.totals.cacheSavingsUsd)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border bg-card p-4">
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd className="font-semibold text-xl tabular-nums">
                    <output aria-label={label}>{value}</output>
                  </dd>
                </div>
              ))}
            </dl>
            {(status?.unpriced ?? []).map((u) => (
              <p key={u.model} className="text-muted-foreground text-xs">
                {t("costsUi.unpriced", { model: u.model })}
              </p>
            ))}
            <section aria-label={t("costsUi.perDay")}>
              <Panel title={t("costsUi.perDay")}>
                <div className="flex h-40 items-end gap-1">
                  {daysBetween(days.from, days.to).map((day) => (
                    <div
                      key={day}
                      data-day={day}
                      className="flex h-full min-w-2 flex-1 flex-col justify-end"
                      title={day}
                    >
                      {byDay
                        .filter((row) => row.day === day)
                        .map((row, i) => (
                          <div
                            key={row.projectKey}
                            role="img"
                            aria-label={`${day} · ${projectLabel(row.projectKey)}: ${usd(row.costUsd)}`}
                            className={cn(
                              "border-card border-t first:rounded-t-sm",
                              SEGMENTS[i % SEGMENTS.length],
                            )}
                            style={{
                              height: `${highest > 0 ? (row.costUsd / highest) * 100 : 0}%`,
                            }}
                          />
                        ))}
                    </div>
                  ))}
                </div>
              </Panel>
            </section>
            <div className="grid gap-4 md:grid-cols-3">
              <Breakdown
                name={t("costsUi.byProject")}
                rows={summary.byProject.map((p) => ({
                  label: projectLabel(p.projectKey),
                  costUsd: p.costUsd,
                }))}
              />
              <Breakdown
                name={t("costsUi.byModel")}
                rows={summary.byModel.map((m) => ({ label: m.model, costUsd: m.costUsd }))}
              />
              <Breakdown
                name={t("costsUi.byOrigin")}
                rows={summary.byOrigin.map((o) => ({ label: o.origin, costUsd: o.costUsd }))}
              />
            </div>
            <QuotaCharts key={hostId} store={store} hostId={hostId} />
            <section aria-label={t("costsUi.top")}>
              <Panel title={t("costsUi.top")}>
                <ul className="flex flex-col">
                  {summary.topSessions.map((s) => (
                    <li key={s.claudeSessionId}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto w-full justify-start whitespace-normal py-1 text-left"
                        onClick={() => props.onOpenSession(hostId, s)}
                      >
                        {`${s.title ?? basename(s.cwd ?? s.claudeSessionId)} · ${projectLabel(s.projectKey)} · ${usd(s.costUsd)}`}
                      </Button>
                    </li>
                  ))}
                </ul>
              </Panel>
            </section>
          </>
        )}
      </div>
    </Page>
  );
}
