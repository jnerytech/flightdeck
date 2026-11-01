import type { CostsFilter, CostsStatus, CostsSummary, UsageOrigin } from "@flightdeck/protocol";
import { Coins } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { DayChart } from "@/components/costs/day-chart";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { NativeSelect } from "@/components/layout/form";
import { Page } from "@/components/layout/page";
import { Panel } from "@/components/layout/panel";
import { Toolbar } from "@/components/layout/stack";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMinLoading } from "@/hooks/use-min-loading";
import { useFormatNumber, useT } from "@/i18n/context";
import { useStoreSlice } from "@/lib/use-store";
import type { Key } from "../i18n/index.ts";
import type { AppStore } from "../lib/app-store.ts";
import { costByClient, loadCostsSummary } from "../lib/client-costs.ts";
import { ALL_CLIENTS } from "../lib/client-scope.ts";
import { daysBetween, PERIODS, type Period, periodRange, projectLabel, usd } from "../lib/costs.ts";
import { basename } from "../lib/paths.ts";
import { hasFeature } from "../lib/version.ts";
import { QuotaCharts } from "./QuotaCharts.tsx";
import { TimingBreakdown } from "./TimingBreakdown.tsx";

/** The host choice that adds every host up (phase 29). */
const ALL_HOSTS = "__all__";

const ORIGINS: UsageOrigin[] = ["terminal", "app", "card", "workflow", "subagent"];

/** The costs of `ids` for the selected client, from the hosts' own `costs.summary`. */
function askCosts(store: AppStore, ids: string[], filter: CostsFilter, selection: string) {
  return loadCostsSummary({
    hostIds: ids,
    filter,
    selection,
    scope: store.clientScope(),
    ask: (id, f) => store.hostCommand(id, "costs.summary", f),
  });
}

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

const COSTSPAGE_KEYS = [
  "personas",
  "hosts",
  "clientSelection",
  "clientList",
  "clientOverrides",
] as const;

/**
 * Estimated cost of every session of a host (terminal, app, cards and workflows), from the
 * transcripts, in API prices: totals, a daily chart stacked by project, breakdowns, the most
 * expensive sessions and a CSV export.
 */
export const CostsPage = memo(function CostsPage(props: {
  store: AppStore;
  onOpenSession(hostId: string, session: TopSession): void;
}) {
  const t = useT();
  const number = useFormatNumber();
  const { store } = props;
  const state = useStoreSlice(store, COSTSPAGE_KEYS);
  const hosts = state.hosts.filter(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "costs", false),
  );
  /** The host the user picked; until then (or if it left), the first one that announces costs. */
  const [chosen, setChosen] = useState("");
  const acrossHosts = chosen === ALL_HOSTS && hosts.length > 1;
  const hostId = acrossHosts
    ? ALL_HOSTS
    : hosts.some((h) => h.id === chosen)
      ? chosen
      : (hosts[0]?.id ?? "");
  const hostIds = acrossHosts ? hosts.map((h) => h.id) : hostId ? [hostId] : [];
  const personaHosts = hosts.filter(
    (h) => hostIds.includes(h.id) && hasFeature(h.hostInfo?.features, "personas", false),
  );
  const withTelemetry = hasFeature(
    hosts.find((h) => h.id === hostId)?.hostInfo?.features,
    "telemetry",
    false,
  );
  const withPersonas = personaHosts.length > 0;
  const personaKey = personaHosts.map((h) => h.id).join("|");
  // The names of the personas the breakdown shows (phase 20).
  useEffect(() => {
    for (const id of personaKey.split("|")) if (id) void store.loadPersonas(id);
  }, [store, personaKey]);
  const personaName = (id: string | null) => {
    const found = personaHosts.flatMap((h) => state.personas[h.id] ?? []).find((p) => p.id === id);
    return id === null ? t("costsUi.noPersona") : (found?.name ?? id);
  };
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
  const selection = state.clientSelection;
  const [sessionHost, setSessionHost] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string[]>([]);
  // What the screen asks for: the hosts, the period, the filters, the client and how the client's
  // projects are placed (a change to the clients asks again).
  const placed = JSON.stringify([state.clientList, state.clientOverrides]);
  const key = JSON.stringify([hostIds, filter, selection, placed]);
  useEffect(() => {
    const [ids, asked] = JSON.parse(key) as [string[], CostsFilter];
    if (ids.length === 0) return;
    let live = true;
    void askCosts(store, ids, asked, selection).then((loaded) => {
      if (!live) return;
      setSummary(loaded.summary);
      setSessionHost(loaded.sessionHost);
      setFailed(loaded.failed);
    });
    return () => {
      live = false;
    };
  }, [store, key, selection]);
  const daysKey = JSON.stringify([hostIds, days, selection, placed]);
  useEffect(() => {
    const [ids, asked] = JSON.parse(daysKey) as [string[], CostsFilter];
    if (ids.length === 0) return;
    let live = true;
    void askCosts(store, ids, asked, selection).then((loaded) => {
      if (live) setAll(loaded.summary);
    });
    return () => {
      live = false;
    };
  }, [store, daysKey, selection]);
  useEffect(() => {
    if (hostId && !acrossHosts) void store.hostCommand(hostId, "costs.status", {}).then(setStatus);
    else setStatus(null);
  }, [store, hostId, acrossHosts]);
  const setFilter = (name: keyof typeof filters, value: string) => {
    const { [name]: _old, ...rest } = filters;
    setFilters(value ? { ...rest, [name]: value } : rest);
  };
  const exportCsv = async () => {
    const file = await store.hostCommand(hostId, "costs.export", filter);
    if (file) await store.saveFile(file.filename, file.csv);
  };
  const byDay = summary?.byDay ?? [];
  // The split by client is the whole spend of the period: it is not shown for one client.
  const scope = store.clientScope();
  const byClient =
    summary && scope.active && selection === ALL_CLIENTS
      ? costByClient(summary, scope, state.clientList, t("clients.unassigned"))
      : [];

  const loading = useMinLoading(hostId !== "" && summary === null);
  const empty = summary !== null && summary.totals.costUsd === 0 && summary.byDay.length === 0;
  return (
    <Page
      title={t("costsUi.title")}
      subtitle={t("costsUi.subtitle")}
      toolbar={
        <Toolbar label={t("costsUi.filters")}>
          <NativeSelect
            inline
            compact
            aria-label={t("costsUi.host")}
            value={hostId}
            onChange={(e) => setChosen(e.target.value)}
          >
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
            {hosts.length > 1 && <option value={ALL_HOSTS}>{t("costsUi.allHosts")}</option>}
          </NativeSelect>
          {PERIODS.map((p) => (
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
          <NativeSelect
            inline
            compact
            aria-label={t("costsUi.project")}
            value={filters.projectKey ?? ""}
            onChange={(e) => setFilter("projectKey", e.target.value)}
          >
            <option value="">{t("costsUi.allProjects")}</option>
            {(all?.byProject ?? []).map((p) => (
              <option key={p.projectKey} value={p.projectKey}>
                {projectLabel(p.projectKey)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            inline
            compact
            aria-label={t("costsUi.model")}
            value={filters.model ?? ""}
            onChange={(e) => setFilter("model", e.target.value)}
          >
            <option value="">{t("costsUi.allModels")}</option>
            {(all?.byModel ?? []).map((m) => (
              <option key={m.model} value={m.model}>
                {m.model}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            inline
            compact
            aria-label={t("costsUi.origin")}
            value={filters.origin ?? ""}
            onChange={(e) => setFilter("origin", e.target.value)}
          >
            <option value="">{t("costsUi.allOrigins")}</option>
            {ORIGINS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </NativeSelect>
          {!acrossHosts && (
            <Button variant="outline" size="sm" onClick={() => void exportCsv()}>
              {t("costsUi.export")}
            </Button>
          )}
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
        {acrossHosts && state.hosts.some((h) => !hosts.includes(h)) && (
          <InlineNotice>
            {t("costsUi.hostsSkipped", {
              hosts: state.hosts
                .filter((h) => !hosts.includes(h))
                .map((h) => h.name)
                .join(", "),
            })}
          </InlineNotice>
        )}
        {failed.length > 0 && (
          <InlineNotice>
            {t("costsUi.hostsFailed", {
              hosts: failed
                .map((id) => state.hosts.find((h) => h.id === id)?.name ?? id)
                .join(", "),
            })}
          </InlineNotice>
        )}
        {selection !== ALL_CLIENTS && (
          <InlineNotice>
            {t("costsUi.onlyClient", {
              name:
                state.clientList.find((c) => c.id === selection)?.name ?? t("clients.unassigned"),
            })}
          </InlineNotice>
        )}
        {status && status.telemetryDivergences.length > 0 && (
          <InlineNotice>
            {t("telemetry.divergence", {
              items: status.telemetryDivergences
                .map((d) =>
                  t("telemetry.divergenceItem", {
                    session: d.claudeSessionId.slice(0, 8),
                    computed: usd(d.computedUsd),
                    telemetry: usd(d.telemetryUsd),
                  }),
                )
                .join("; "),
            })}
          </InlineNotice>
        )}
        {hosts.length === 0 && (
          <EmptyState
            icon={Coins}
            title={t("costsUi.noHost")}
            action={
              <Button variant="link" onClick={() => props.store.router.push({ name: "add-host" })}>
                {t("costsUi.noHostLink")}
              </Button>
            }
          />
        )}
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
                [t("costsUi.tokens"), number(tokensOf(summary.totals.tokens))],
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
                <DayChart
                  days={daysBetween(days.from, days.to)}
                  byDay={byDay}
                  projects={summary.byProject.map((p) => p.projectKey)}
                />
              </Panel>
            </section>
            <div className="grid gap-4 @3xl:grid-cols-3">
              <Breakdown
                name={t("costsUi.byProject")}
                rows={summary.byProject.map((p) => ({
                  label: projectLabel(p.projectKey),
                  costUsd: p.costUsd,
                }))}
              />
              {byClient.length > 0 && (
                <Breakdown
                  name={t("costsUi.byClient")}
                  rows={byClient.map((c) => ({ label: c.name, costUsd: c.costUsd }))}
                />
              )}
              <Breakdown
                name={t("costsUi.byModel")}
                rows={summary.byModel.map((m) => ({ label: m.model, costUsd: m.costUsd }))}
              />
              <Breakdown
                name={t("costsUi.byOrigin")}
                rows={summary.byOrigin.map((o) => ({ label: o.origin, costUsd: o.costUsd }))}
              />
              {withPersonas && (
                <Breakdown
                  name={t("costsUi.byPersona")}
                  rows={summary.byPersona.map((p) => ({
                    label: personaName(p.persona),
                    costUsd: p.costUsd,
                  }))}
                />
              )}
            </div>
            {!acrossHosts && <QuotaCharts key={hostId} store={store} hostId={hostId} />}
            {withTelemetry && <TimingBreakdown key={hostId} store={store} hostId={hostId} />}
            <section aria-label={t("costsUi.top")}>
              <Panel title={t("costsUi.top")}>
                <ul className="flex flex-col">
                  {summary.topSessions.map((s) => (
                    <li key={s.claudeSessionId}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto w-full justify-start whitespace-normal py-1 text-left"
                        onClick={() =>
                          props.onOpenSession(sessionHost[s.claudeSessionId] ?? hostId, s)
                        }
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
});
