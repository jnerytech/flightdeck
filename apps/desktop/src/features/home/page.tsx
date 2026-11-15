import { useMemo, useSyncExternalStore } from "react";
import { knownProjectKeys } from "@/features/projects/index.ts";
import { useProjectLabels } from "@/hooks/use-project-labels";
import { formatAgo, formatCompact, formatNumber, formatSeconds, formatUsd } from "@/i18n/format";
import { Grid, Page, Stack } from "@/shared/layout/index.ts";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import type { Route } from "../../lib/router.ts";
import { hasFeature } from "../../lib/version.ts";
import {
  ALL_HOSTS,
  activeScope,
  daysBetween,
  periodRange,
  projectLabel,
  projectPath,
  scopeHosts,
} from "../costs/index.ts";
import { homeKey } from "./domain/home-cache.ts";
import { type HomeKpis, homeKpis } from "./domain/home-kpis.ts";
import { homeMessage, rangeSubtitle } from "./domain/home-view-model.ts";
import { AwayNotice, HomeScopeMenu, ReadNotices } from "./home-notices.tsx";
import { KpiCard } from "./kpi-card.tsx";
import { Leaderboard } from "./leaderboard.tsx";
import { PERIOD, useHomeRead } from "./use-home-read.ts";

/** What Home is about (#126): the scope it adds up, the hosts in it, the projects to pick, and the subtitle. */
function useHomeScope(store: AppStore, state: Pick<AppState, "hosts" | "hostsLoaded">) {
  const { t } = store.i18n;
  // The data scope (#126): Home adds up only the hosts in it; a host no longer there means all,
  // once the host list is read (before, a kept host is only not listed yet, and Home asks nobody).
  const kept = useSyncExternalStore(store.dataScope.subscribe, () => store.dataScope.value);
  const scope = activeScope(kept, state.hosts, state.hostsLoaded);
  /** A project scope (#126 slice 4): that project's numbers, on every host. */
  const projectKey = scope.kind === "project" ? scope.projectKey : undefined;
  const hosts = useMemo(() => scopeHosts(state.hosts, scope), [state.hosts, scope]);
  /** The scoped host, when it is offline (not still connecting): Home says so and offers all. */
  const away =
    scope.kind === "host"
      ? hosts.find((host) => host.status !== "online" && host.status !== "connecting")
      : undefined;
  // The projects the app knows, for the Projects group of the scope menu (#126 slice 4).
  const seen = store.projectKeys.all();
  const listed = store.getState().projects;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` says when new keys were seen
  const knownKeys = useMemo(
    () => [...new Set([...seen, ...knownProjectKeys(listed), ...(projectKey ? [projectKey] : [])])],
    [store.projectKeys.version, listed, projectKey],
  );
  const projectNames = useProjectLabels(store, knownKeys);
  const projects = useMemo(
    () =>
      knownKeys
        .map((key) => ({ key, label: projectNames.get(key) ?? projectLabel(key) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [knownKeys, projectNames],
  );
  /** The subtitle says whose numbers they are, as the scope menu does. */
  const scoped = scope.kind === "host" ? hosts[0]?.name : undefined;
  // A kept host not listed yet has no name: the subtitle names no scope rather than "all hosts".
  const subtitle = rangeSubtitle(
    t,
    scope,
    scoped,
    projectKey ? projectNames.get(projectKey) : undefined,
  );
  return { scope, projectKey, hosts, away, projects, subtitle };
}

/**
 * Home: the last seven days of every online host in four cards (spend, turns, tokens, the average
 * turn), from the hosts' own costs and usage; no command of its own.
 */
export function HomePage(
  props: Readonly<{
    store: AppStore;
    /** The parts of the state Home reads: the hosts, whether the list was read, and the budgets. */
    state: Pick<AppState, "hosts" | "hostsLoaded" | "budgets">;
    go(route: Route): void;
    /** How often the numbers are read again, in milliseconds (a minute). */
    refreshMs?: number;
  }>,
) {
  const { store, state, go } = props;
  const { t, lang } = store.i18n;
  const { scope, projectKey, hosts, away, projects, subtitle } = useHomeScope(store, state);
  const online = hosts.filter((host) => host.status === "online");
  const key = online.map((host) => host.id).join(",");
  /** The cache's entry: every host of the set, whether it is online now or not. */
  const entry = homeKey(
    PERIOD,
    hosts.map((host) => host.id),
    projectKey,
  );
  const only = projectKey ? { projectKey } : {};
  const range = periodRange(PERIOD, store.today());
  const days = useMemo(() => daysBetween(range.from, range.to), [range.from, range.to]);
  const { fetched, leaders } = useHomeRead(store, {
    online,
    entry,
    key,
    span: { range, days, only, projectKey },
    refreshMs: props.refreshMs,
  });
  // What is on screen at once: this visit's read, or else the last one of the same hosts and period.
  const data = fetched?.entry === entry ? fetched.hosts : (store.homeCache.get(entry) ?? null);

  const kpis: HomeKpis | null = useMemo(() => {
    if (!data) return null;
    const answers = Object.values(data);
    return homeKpis({
      days,
      costs: answers.flatMap((a) => (a.costs ? [a.costs] : [])),
      usage: answers.flatMap((a) => (a.usage ? [a.usage] : [])),
      budgets: hosts.flatMap((host) => state.budgets[host.id] ?? []),
      ...(projectKey ? { projectKey } : {}),
    });
  }, [data, days, state.budgets, hosts, projectKey]);
  const read = fetched?.entry === entry ? fetched : null;
  /** Hosts whose numbers on screen are from an earlier read: the last read did not refresh them. */
  const stale = hosts.filter(
    (host) => read && !read.answered.includes(host.id) && read.kept.includes(host.id),
  );
  /** Hosts that did not answer and have no numbers at all. */
  const silent = hosts.filter(
    (host) => read?.failed.includes(host.id) && !read.kept.includes(host.id),
  );
  /** The oldest numbers on screen: the line says how old the whole picture can be. */
  const oldest = Math.min(...Object.values(data ?? {}).map((host) => host.at));
  const ago = formatAgo(Math.max(0, store.now() - oldest), t);

  const usdOf = (value: number) => formatUsd(value, lang);
  const unknown = t("home.unknown");
  const series = (card: string, values: number[], format: (v: number) => string) =>
    t("home.chart", { card, values: values.map(format).join(", ") });
  // At start the hosts are still connecting: that is not "no host".
  const connecting = !state.hostsLoaded || hosts.some((host) => host.status === "connecting");
  const busy = !kpis && (online.length === 0 ? connecting : true);
  const message = homeMessage(t, { ready: kpis !== null, away, connecting, online: online.length });
  // Hosts that do not have costs at all: their spend is unknown, which is not the same as none.
  const withoutCosts = online
    .filter((host) => !hasFeature(host.hostInfo?.features, "costs", false))
    .map((host) => host.name);
  // Costs and History open on the days the cards show, and on every host Home added up.
  const withCosts = online.filter((host) => hasFeature(host.hostInfo?.features, "costs", false));
  const openCosts = () =>
    go({
      name: "costs",
      period: "7d",
      ...(withCosts.length > 1 ? { host: ALL_HOSTS } : {}),
    });
  // History is one host's: with several, the screen that adds them up is Costs.
  const openProject = (projectKey: string) =>
    go({
      name: "costs",
      period: "7d",
      ...(withCosts.length > 1 ? { host: ALL_HOSTS } : {}),
      projectKey,
    });
  const board = leaders?.entry === entry ? leaders : null;
  const shown = board?.leaders ?? null;
  // One label per project on every screen: told apart against all the keys known, not only these rows.
  const labels = useProjectLabels(
    store,
    shown?.project.flatMap((row) => (row.key ? [row.key] : [])) ?? [],
  );
  const openTurns = () => {
    const only = online.length === 1 ? online[0] : undefined;
    if (only) go({ name: "history", host: only.id, from: range.from, to: range.to });
    else if (online.length > 1) openCosts();
  };

  return (
    <Page
      title={t("home.title")}
      subtitle={subtitle}
      toolbar={
        <HomeScopeMenu
          store={store}
          hosts={state.hosts}
          loaded={state.hostsLoaded}
          projects={projects}
          scope={scope}
        />
      }
    >
      {/* One live region from the first word to the numbers: its change is what is announced. */}
      <output
        aria-busy={busy ? true : undefined}
        className={kpis ? "sr-only" : "block text-muted-foreground text-sm"}
      >
        {message}
      </output>
      <AwayNotice store={store} away={away} withNumbers={kpis !== null} />
      {kpis && (
        <Stack gap={4}>
          <p className="text-muted-foreground text-xs">{t("home.updated", { ago })}</p>
          <ReadNotices
            t={t}
            stale={stale}
            silent={silent}
            ago={ago}
            olderDaemon={kpis.turns.failed === null}
          />
          <Grid cols={{ base: 1, sm: 2, xl: 4 }} gap={4}>
            <KpiCard
              title={t("home.spend")}
              openLabel={t("home.openCard", { card: t("home.spend") })}
              value={kpis.spend.totalUsd === null ? unknown : usdOf(kpis.spend.totalUsd)}
              details={
                <>
                  <span>
                    {kpis.spend.budget
                      ? t("home.ofBudget", {
                          spent: usdOf(kpis.spend.budget.spentUsd),
                          limit: usdOf(kpis.spend.budget.limitUsd),
                        })
                      : t("home.noBudget")}
                  </span>
                  {withoutCosts.length > 0 && (
                    <span>{t("home.noCosts", { hosts: withoutCosts.join(", ") })}</span>
                  )}
                </>
              }
              series={kpis.spend.series}
              seriesLabel={series(t("home.spend"), kpis.spend.series, usdOf)}
              onOpen={openCosts}
            />
            <KpiCard
              title={t("home.turns")}
              openLabel={t("home.openCard", { card: t("home.turns") })}
              value={formatNumber(kpis.turns.total, lang)}
              details={
                <>
                  <span>{t("home.turnsOk", { n: formatNumber(kpis.turns.ok, lang) })}</span>
                  {kpis.turns.failed !== null && (
                    <span>
                      {t("home.turnsFailed", { n: formatNumber(kpis.turns.failed, lang) })}
                    </span>
                  )}
                </>
              }
              series={kpis.turns.series}
              seriesLabel={series(t("home.turns"), kpis.turns.series, (v) => formatNumber(v, lang))}
              onOpen={openTurns}
            />
            <KpiCard
              title={t("home.tokens")}
              openLabel={t("home.openCard", { card: t("home.tokens") })}
              value={kpis.tokens.total === null ? unknown : formatCompact(kpis.tokens.total, lang)}
              details={
                kpis.tokens.cacheRead === null
                  ? unknown
                  : t("home.cacheRead", { n: formatCompact(kpis.tokens.cacheRead, lang) })
              }
              series={kpis.tokens.series}
              seriesLabel={series(t("home.tokens"), kpis.tokens.series, (v) =>
                formatCompact(v, lang),
              )}
              onOpen={openCosts}
            />
            <KpiCard
              title={t("home.average")}
              openLabel={t("home.openCard", { card: t("home.average") })}
              value={
                kpis.average.costPerTurnUsd === null ? unknown : usdOf(kpis.average.costPerTurnUsd)
              }
              details={
                <>
                  <span>{t("home.avgBasis")}</span>
                  <span>
                    {t("home.avgTime")}:{" "}
                    {kpis.average.turnMs === null
                      ? unknown
                      : formatSeconds(kpis.average.turnMs, lang, t)}
                  </span>
                  <span>
                    {kpis.average.successRate === null
                      ? unknown
                      : t("home.successRate", {
                          rate: `${formatNumber(Math.round(kpis.average.successRate * 1000) / 10, lang)}%`,
                        })}
                  </span>
                </>
              }
              series={kpis.average.series}
              seriesLabel={series(t("home.average"), kpis.average.series, usdOf)}
              onOpen={openCosts}
            />
          </Grid>
          {withCosts.length > 0 && (
            <Leaderboard
              t={t}
              lang={lang}
              leaders={shown}
              unavailable={board !== null && board.leaders === null}
              projectName={(key) => labels.get(key) ?? key}
              projectTitle={projectPath}
              onOpenProject={openProject}
            />
          )}
        </Stack>
      )}
    </Page>
  );
}
