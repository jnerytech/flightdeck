import type { CostsFilter, CostsSummary } from "@flightdeck/protocol";
import { Coins } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ALL_CLIENTS, costByClient } from "@/features/clients/index.ts";
import { RoiPeople, RoiSettingsPanel, RoiTable } from "@/features/roi/ui.ts";
import { useProjectLabels } from "@/hooks/use-project-labels";
import { useT } from "@/i18n/context";
import { useStoreSlice } from "@/lib/use-store";
import { InlineNotice } from "@/shared/feedback/index.ts";
import { useMinLoading } from "@/shared/hooks/index.ts";
import { EmptyState, LoadingState, Page, Panel } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";
import { CostsQuotaLead } from "./CostsQuotaLead.tsx";
import { exportCosts } from "./costs-export.ts";
import { CostsFilters } from "./costs-filters.tsx";
import { CostsNotices } from "./costs-parts.tsx";
import { CostsBreakdowns, CostsTopSessions, CostsTotals } from "./costs-report.tsx";
import { DayChart } from "./day-chart.tsx";
import { daysBetween, type Period, periodRange, projectLabel } from "./domain/costs.ts";
import {
  costsHosts,
  hostsOffering,
  labelledKeys,
  periodProjectKeys,
  withFilter,
} from "./domain/costs-derive.ts";
import { awayHost, hostScope } from "./domain/costs-scope.ts";
import { awayKey } from "./domain/data-scope.ts";
import { QuotaCharts } from "./QuotaCharts.tsx";
import { TimingBreakdown } from "./TimingBreakdown.tsx";
import { useCostsLoad, useCostsRoute, useCostsStatus } from "./use-costs-page.ts";

export type TopSession = CostsSummary["topSessions"][number];

const COSTSPAGE_KEYS = [
  "personas",
  "hosts",
  "clientSelection",
  "clientList",
  "clientOverrides",
  "hostsLoaded",
] as const;

/**
 * Estimated cost of every session of a host (terminal, app, cards and workflows), from the
 * transcripts, in API prices: totals, a daily chart stacked by project, breakdowns, the most
 * expensive sessions and a CSV export.
 */
export const CostsPage = memo(function CostsPage(props: {
  store: AppStore;
  onOpenSession(hostId: string, session: TopSession): void;
  /** What an alert opens the screen on: its host, its project and its client. */
  host?: string;
  projectKey?: string;
  client?: string;
  /** The period it opens on (Home points at the last seven days). */
  period?: Exclude<Period, "range">;
}) {
  const t = useT();
  const { store } = props;
  const state = useStoreSlice(store, COSTSPAGE_KEYS);
  const hosts = costsHosts(state.hosts);
  const { setRouteHost, setRouteProject, projectKey, hostSide, dataScope, endVisit, showAllHosts } =
    useCostsRoute(store, state, props);
  const { acrossHosts, hostId, hostIds } = hostScope(hostSide, hosts);
  const away = awayHost(hostSide, state.hosts, hosts);
  const personaHosts = hostsOffering(hosts, hostIds, "personas");
  const withTelemetry = hasFeature(
    hosts.find((h) => h.id === hostId)?.hostInfo?.features,
    "telemetry",
    false,
  );
  const withPersonas = personaHosts.length > 0;
  const roiHosts = hostsOffering(hosts, hostIds, "roi").map((h) => h.id);
  const withRoi = roiHosts.length > 0;
  const personaKey = personaHosts.map((h) => h.id).join("|");
  // The names of the personas the breakdown shows (phase 20).
  useEffect(() => {
    for (const id of personaKey.split("|")) if (id) void store.personas.load(id);
  }, [store, personaKey]);
  const personaName = (id: string | null) => {
    const found = personaHosts.flatMap((h) => state.personas[h.id] ?? []).find((p) => p.id === id);
    return id === null ? t("costsUi.noPersona") : (found?.name ?? id);
  };
  const [period, setPeriod] = useState<Period>(props.period ?? "7d");
  const today = store.today();
  const [range, setRange] = useState(periodRange(props.period ?? "7d", today));
  const [filters, setFilters] = useState<Omit<CostsFilter, "from" | "to" | "projectKey">>({});
  // A later alert opens another host, project or client while the screen is already up.
  const { host: alertHost, projectKey: alertProject, client: alertClient } = props;
  useEffect(() => {
    if (alertHost) setRouteHost(alertHost);
    setRouteProject(alertProject ?? null);
    setFilters({});
    if (alertClient) store.clientScope.select(alertClient);
  }, [store, alertHost, alertProject, alertClient, setRouteHost, setRouteProject]);
  const days = period === "range" ? range : periodRange(period, today);
  const filter: CostsFilter = { ...days, ...filters, ...(projectKey ? { projectKey } : {}) };
  const selection = state.clientSelection;
  // The filters offer every project and model of the period: with no filter set, that is the
  // summary itself, and it is not asked for twice.
  const unfiltered = Object.keys(filters).length === 0 && !projectKey;
  const { summary, all, sessionHost, failed } = useCostsLoad(store, {
    hostIds,
    filter,
    days,
    unfiltered,
    selection,
    placed: JSON.stringify([state.clientList, state.clientOverrides]),
  });
  const status = useCostsStatus(store, hostId, acrossHosts);
  const setFilter = (name: keyof typeof filters, value: string) =>
    setFilters(withFilter(filters, name, value));
  const exportCsv = () => exportCosts(store, { acrossHosts, hostId, hosts }, filter);
  const byDay = summary?.byDay ?? [];
  // One set of labels for the whole screen, so a project reads the same in the list, the chart
  // and the table; two that share a folder name are told apart.
  // They are told apart against every project the app knows, as on Home (issue #881).
  const labels = useProjectLabels(store, labelledKeys({ all, summary }, projectKey));
  const projectName = (key: string) => labels.get(key) ?? projectLabel(key);
  /** The period's projects, for the scope menu; the chosen one stays listed (slice 4). */
  const projects = periodProjectKeys(all, projectKey).map((key) => ({
    key,
    label: projectName(key),
  }));
  // The split by client is the whole spend of the period: it is not shown for one client.
  const scope = store.clientScope.get();
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
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => store.router.push({ name: "settings", section: "budgets" })}
          >
            {t("costsUi.setBudget")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void exportCsv()}>
            {t("costsUi.export")}
          </Button>
        </>
      }
      toolbar={
        <CostsFilters
          store={store}
          hosts={state.hosts}
          projects={projects}
          scope={dataScope}
          onPickScope={endVisit}
          period={period}
          onPeriod={setPeriod}
          range={range}
          onRange={setRange}
          filters={filters}
          onFilter={setFilter}
          models={(all?.byModel ?? []).map((m) => m.model)}
        />
      }
    >
      <div className="flex flex-col gap-5">
        <CostsNotices
          status={status}
          acrossHosts={acrossHosts}
          allHosts={state.hosts}
          hosts={hosts}
          failed={failed}
          selection={selection}
          clients={state.clientList}
        />
        {away && (
          <InlineNotice tone="info">
            <span>
              {t(away.status === "online" ? "scope.noCosts" : awayKey(away.status, "numbers"), {
                host: away.name,
              })}{" "}
            </span>
            <Button variant="outline" size="sm" onClick={showAllHosts}>
              {t("scope.showAll")}
            </Button>
          </InlineNotice>
        )}
        {/* On a subscription the plan quota leads: the dollars are an estimate that is not charged. */}
        <CostsQuotaLead store={props.store} hostIds={hostIds} />
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
        {loading && <LoadingState label={t("costsUi.loading")} shape="tiles" />}
        {empty && projectKey && (
          <InlineNotice tone="info">
            <span>{t("scope.projectEmpty", { project: projectName(projectKey) })} </span>
            <Button variant="outline" size="sm" onClick={showAllHosts}>
              {t("scope.showAll")}
            </Button>
          </InlineNotice>
        )}
        {empty && !projectKey && (
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
            <CostsTotals summary={summary} unpriced={status?.unpriced ?? []} />
            <section aria-label={t("costsUi.perDay")}>
              <Panel title={t("costsUi.perDay")}>
                <DayChart
                  days={daysBetween(days.from, days.to)}
                  byDay={byDay}
                  projects={summary.byProject.map((p) => p.projectKey)}
                  label={projectName}
                />
              </Panel>
            </section>
            {withRoi && <RoiPeople store={store} />}
            {withRoi && (
              <RoiTable
                store={store}
                hostIds={roiHosts}
                from={days.from}
                to={days.to}
                selection={selection}
                projectName={projectName}
              />
            )}
            <CostsBreakdowns
              summary={summary}
              projectName={projectName}
              byClient={byClient}
              withPersonas={withPersonas}
              personaName={personaName}
            />
            {acrossHosts ? (
              <InlineNotice tone="info">
                {/* Quota is per host by nature: on every host there is one line, and the way to pick. */}
                <span>{t("costsUi.quotaPick")} </span>
                {hosts.map((h) => (
                  <Button
                    key={h.id}
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setRouteHost(null);
                      store.dataScope.set({ kind: "host", hostId: h.id });
                    }}
                  >
                    {h.name}
                  </Button>
                ))}
              </InlineNotice>
            ) : (
              <QuotaCharts key={`quota-${hostId}`} store={store} hostId={hostId} />
            )}
            {withTelemetry && (
              <TimingBreakdown
                key={`timing-${hostId}`}
                store={store}
                hostId={hostId}
                label={projectName}
              />
            )}
            <CostsTopSessions
              sessions={summary.topSessions}
              projectName={projectName}
              onOpen={(s) => props.onOpenSession(sessionHost[s.claudeSessionId] ?? hostId, s)}
            />
            {/* What the person types for the return on cost, after the reports it changes (#588). */}
            {withRoi && <RoiSettingsPanel store={store} />}
          </>
        )}
      </div>
    </Page>
  );
});
