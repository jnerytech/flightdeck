import type { CostsFilter, CostsStatus, CostsSummary, UsageOrigin } from "@flightdeck/protocol";
import { Coins } from "lucide-react";
import { memo, useEffect, useState, useSyncExternalStore } from "react";
import { DayChart } from "@/components/costs/day-chart";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { NativeSelect } from "@/components/layout/form";
import { Page } from "@/components/layout/page";
import { Panel } from "@/components/layout/panel";
import { Toolbar } from "@/components/layout/stack";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { RoiPeople } from "@/components/roi/roi-people";
import { RoiSettingsPanel } from "@/components/roi/roi-settings-panel";
import { RoiTable } from "@/components/roi/roi-table";
import { ScopeMenu } from "@/components/shell/scope-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMinLoading } from "@/hooks/use-min-loading";
import { useProjectLabels } from "@/hooks/use-project-labels";
import { useFormatNumber, useT } from "@/i18n/context";
import { uniqueKeys } from "@/lib/unique-keys";
import { useStoreSlice } from "@/lib/use-store";
import { cn } from "@/lib/utils";
import type { Key } from "../i18n/index.ts";
import type { AppStore } from "../lib/app-store.ts";
import { costByClient, loadCostsSummary } from "../lib/client-costs.ts";
import { ALL_CLIENTS } from "../lib/client-scope.ts";
import {
  ALL_HOSTS,
  daysBetween,
  PERIODS,
  type Period,
  periodRange,
  projectLabel,
  usd,
} from "../lib/costs.ts";
import { mergeHostCsv } from "../lib/costs-csv.ts";
import { ALL_SCOPE, activeScope, awayKey, type DataScope } from "../lib/data-scope.ts";
import { basename } from "../lib/paths.ts";
import { hasFeature } from "../lib/version.ts";
import { QuotaCharts } from "./QuotaCharts.tsx";
import { TimingBreakdown } from "./TimingBreakdown.tsx";

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
function Breakdown(
  props: Readonly<{
    name: string;
    /** `id` tells rows apart when two share a label (two projects in folders of the same name). */
    rows: Array<{ id?: string; label: string; costUsd: number }>;
  }>,
) {
  return (
    <section aria-label={props.name}>
      <Panel title={props.name}>
        <table className="w-full text-left text-sm tabular-nums">
          <tbody>
            {props.rows.map((row) => (
              <tr key={row.id ?? row.label} className="border-t first:border-t-0">
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
  "hostsLoaded",
] as const;

/**
 * Which host(s) the screen reads (#126): every one that has costs, or the scoped one. A scoped host
 * that is offline or has no costs reads nothing, rather than another host's numbers.
 */
function hostScope(scope: DataScope, hosts: Array<{ id: string }>) {
  if (scope.kind === "host") {
    const there = hosts.some((h) => h.id === scope.hostId);
    return {
      acrossHosts: false,
      hostId: there ? scope.hostId : "",
      hostIds: there ? [scope.hostId] : [],
    };
  }
  const acrossHosts = hosts.length > 1;
  if (acrossHosts) return { acrossHosts, hostId: ALL_HOSTS, hostIds: hosts.map((h) => h.id) };
  const hostId = hosts[0]?.id ?? "";
  return { acrossHosts, hostId, hostIds: hostId ? [hostId] : [] };
}

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
  const number = useFormatNumber();
  const { store } = props;
  const state = useStoreSlice(store, COSTSPAGE_KEYS);
  const hosts = state.hosts.filter(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "costs", false),
  );
  // The data scope (#126) says whose costs these are: every host, one, or one project (slice 4). A
  // route's own host or project (an alert, a Home card) wins for this visit and never rewrites it;
  // choosing in the scope menu ends that choice.
  const keptScope = useSyncExternalStore(store.dataScope.subscribe, () => store.dataScope.value);
  const [routeHost, setRouteHost] = useState<string | null>(props.host ?? null);
  const [routeProject, setRouteProject] = useState<string | null>(props.projectKey ?? null);
  // Home opens Costs with `__all__` when several hosts have costs: every host, for this visit.
  const routeScope: DataScope | null =
    routeHost === null
      ? null
      : routeHost === ALL_HOSTS
        ? ALL_SCOPE
        : { kind: "host", hostId: routeHost };
  const kept = activeScope(keptScope, state.hosts, state.hostsLoaded);
  /** The project whose costs these are, if one: the route's, else the kept scope's. */
  const projectKey =
    routeProject ?? (routeScope === null && kept.kind === "project" ? kept.projectKey : null);
  // A project keeps every host; the route's host still narrows an alert to its host.
  const hostSide = routeScope ?? (kept.kind === "project" ? ALL_SCOPE : kept);
  const dataScope: DataScope = projectKey ? { kind: "project", projectKey } : hostSide;
  const { acrossHosts, hostId, hostIds } = hostScope(hostSide, hosts);
  /** The scoped host when it has no numbers to show: offline, or not reporting costs. */
  const scopedHost =
    hostSide.kind === "host" ? state.hosts.find((h) => h.id === hostSide.hostId) : null;
  const away =
    scopedHost && !hosts.some((h) => h.id === scopedHost.id) && scopedHost.status !== "connecting"
      ? scopedHost
      : null;
  const endVisit = () => {
    setRouteHost(null);
    setRouteProject(null);
  };
  const showAllHosts = () => {
    endVisit();
    store.dataScope.set({ kind: "all" });
  };
  const personaHosts = hosts.filter(
    (h) => hostIds.includes(h.id) && hasFeature(h.hostInfo?.features, "personas", false),
  );
  const withTelemetry = hasFeature(
    hosts.find((h) => h.id === hostId)?.hostInfo?.features,
    "telemetry",
    false,
  );
  const withPersonas = personaHosts.length > 0;
  const roiHosts = hosts
    .filter((h) => hostIds.includes(h.id) && hasFeature(h.hostInfo?.features, "roi", false))
    .map((h) => h.id);
  const withRoi = roiHosts.length > 0;
  const personaKey = personaHosts.map((h) => h.id).join("|");
  // The names of the personas the breakdown shows (phase 20).
  useEffect(() => {
    for (const id of personaKey.split("|")) if (id) void store.loadPersonas(id);
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
    if (alertClient) store.setClientSelection(alertClient);
  }, [store, alertHost, alertProject, alertClient]);
  const [summary, setSummary] = useState<CostsSummary | null>(null);
  /** The period without filters: the filters offer every project and model of it. */
  const [all, setAll] = useState<CostsSummary | null>(null);
  const [status, setStatus] = useState<CostsStatus | null>(null);
  const days = period === "range" ? range : periodRange(period, today);
  const filter: CostsFilter = { ...days, ...filters, ...(projectKey ? { projectKey } : {}) };
  const selection = state.clientSelection;
  const [sessionHost, setSessionHost] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string[]>([]);
  // What the screen asks for: the hosts, the period, the filters, the client and how the client's
  // projects are placed (a change to the clients asks again).
  const placed = JSON.stringify([state.clientList, state.clientOverrides]);
  const key = JSON.stringify([hostIds, filter, selection, placed]);
  useEffect(() => {
    const [ids, asked] = JSON.parse(key) as [string[], CostsFilter];
    if (ids.length === 0) {
      // No host to read (the scoped one is away): no numbers, not the last host's.
      setSummary(null);
      setAll(null);
      return;
    }
    let live = true;
    void askCosts(store, ids, asked, selection).then((loaded) => {
      if (!live) return;
      store.projectKeys.note(loaded.summary?.byProject.map((p) => p.projectKey) ?? []);
      setSummary(loaded.summary);
      if (Object.keys(asked).length === 2) setAll(loaded.summary);
      setSessionHost(loaded.sessionHost);
      setFailed(loaded.failed);
    });
    return () => {
      live = false;
    };
  }, [store, key, selection]);
  // The filters offer every project and model of the period: with no filter set, that is the
  // summary itself, and it is not asked for twice.
  const unfiltered = Object.keys(filters).length === 0 && !projectKey;
  const daysKey = JSON.stringify([unfiltered ? [] : hostIds, days, selection, placed]);
  useEffect(() => {
    const [ids, asked] = JSON.parse(daysKey) as [string[], CostsFilter];
    if (ids.length === 0) return;
    let live = true;
    void askCosts(store, ids, asked, selection).then((loaded) => {
      if (!live) return;
      store.projectKeys.note(loaded.summary?.byProject.map((p) => p.projectKey) ?? []);
      setAll(loaded.summary);
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
    if (!acrossHosts) {
      const file = await store.hostCommand(hostId, "costs.export", filter);
      if (file) await store.saveFile(file.filename, file.csv);
      return;
    }
    // Every host, one file with the host as its first column; a host that does not answer is left out.
    const answers = await Promise.allSettled(
      hosts.map(async (h) => ({
        host: h.name,
        file: await store.hostCommand(h.id, "costs.export", filter),
      })),
    );
    const files = answers.flatMap((answer) => {
      if (answer.status !== "fulfilled" || !answer.value.file) return [];
      return [{ host: answer.value.host, ...answer.value.file }];
    });
    const csv = mergeHostCsv(files);
    const first = files[0];
    if (first && csv !== "") await store.saveFile(first.filename, csv);
  };
  const byDay = summary?.byDay ?? [];
  // The same session can come from two hosts: each row needs a key of its own.
  const topKeys = uniqueKeys((summary?.topSessions ?? []).map((s) => s.claudeSessionId));
  // One set of labels for the whole screen, so a project reads the same in the list, the chart
  // and the table; two that share a folder name are told apart.
  // They are told apart against every project the app knows, as on Home (issue #881).
  const labels = useProjectLabels(store, [
    ...new Set([
      ...(all?.byProject ?? []).map((p) => p.projectKey),
      ...(summary?.byProject ?? []).map((p) => p.projectKey),
      ...(summary?.topSessions ?? []).map((s) => s.projectKey),
      ...(projectKey ? [projectKey] : []),
    ]),
  ]);
  const projectName = (key: string) => labels.get(key) ?? projectLabel(key);
  /** The period's projects, for the scope menu; the chosen one stays listed (slice 4). */
  const projects = [
    ...new Set([
      ...(all?.byProject ?? []).map((p) => p.projectKey),
      ...(projectKey ? [projectKey] : []),
    ]),
  ].map((key) => ({ key, label: projectName(key) }));
  // The split by client is the whole spend of the period: it is not shown for one client.
  const scope = store.clientScope();
  const byClient =
    summary && scope.active && selection === ALL_CLIENTS
      ? costByClient(summary, scope, state.clientList, t("clients.unassigned"))
      : [];

  const loading = useMinLoading(hostId !== "" && summary === null);
  const topModel = [...(summary?.byModel ?? [])].sort((a, b) => b.costUsd - a.costUsd)[0];
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
        <Toolbar label={t("costsUi.filters")}>
          {(state.hosts.length > 1 || projects.length > 0) && (
            <ScopeMenu
              store={store}
              hosts={state.hosts}
              projects={projects}
              scope={dataScope}
              onPick={endVisit}
            />
          )}
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
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3">
              {[
                [t("costsUi.estimated"), usd(summary.totals.costUsd)],
                [t("costsUi.tokens"), number(tokensOf(summary.totals.tokens))],
                [t("costsUi.cacheSavings"), usd(summary.totals.cacheSavingsUsd)],
                ...(topModel
                  ? [[t("costsUi.topModel"), `${topModel.model} · ${usd(topModel.costUsd)}`]]
                  : []),
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border bg-card p-4">
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd
                    className={cn(
                      "font-semibold tabular-nums",
                      label === t("costsUi.topModel") ? "text-base" : "text-xl",
                    )}
                  >
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
            <div className="grid gap-4 @3xl:grid-cols-3">
              <Breakdown
                name={t("costsUi.byProject")}
                rows={summary.byProject.map((p) => ({
                  id: p.projectKey,
                  label: projectName(p.projectKey),
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
            <section aria-label={t("costsUi.top")}>
              <Panel title={t("costsUi.top")}>
                <ul className="flex flex-col">
                  {summary.topSessions.map((s, i) => (
                    <li key={topKeys[i]}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto w-full justify-start whitespace-normal py-1 text-left"
                        onClick={() =>
                          props.onOpenSession(sessionHost[s.claudeSessionId] ?? hostId, s)
                        }
                      >
                        {`${s.title ?? basename(s.cwd ?? s.claudeSessionId)} · ${projectName(s.projectKey)} · ${usd(s.costUsd)}`}
                      </Button>
                    </li>
                  ))}
                </ul>
              </Panel>
            </section>
            {/* What the person types for the return on cost, after the reports it changes (#588). */}
            {withRoi && <RoiSettingsPanel store={store} />}
          </>
        )}
      </div>
    </Page>
  );
});
