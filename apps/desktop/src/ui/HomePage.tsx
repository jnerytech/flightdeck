import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { KpiCard } from "@/components/home/kpi-card";
import { Leaderboard } from "@/components/home/leaderboard";
import { Page } from "@/components/layout/page";
import { Grid, Stack } from "@/components/layout/stack";
import { ScopeMenu } from "@/components/shell/scope-menu";
import { Button } from "@/components/ui/button";
import { formatAgo, formatCompact, formatNumber, formatSeconds, formatUsd } from "@/i18n/format";
import type { AppState, AppStore } from "../lib/app-store.ts";
import { mergeSummaries } from "../lib/client-costs.ts";
import { ALL_HOSTS, daysBetween, periodRange, projectLabels } from "../lib/costs.ts";
import { ALL_SCOPE, activeScope, scopeHosts } from "../lib/data-scope.ts";
import { type HomeSnapshot, homeHostData, homeKey } from "../lib/home-cache.ts";
import { type HomeKpis, homeKpis } from "../lib/home-kpis.ts";
import { type HomeLeaders, homeLeaders } from "../lib/home-leaders.ts";
import type { Route } from "../lib/router.ts";
import { hasFeature } from "../lib/version.ts";

/** The period the cards show; the cache keeps one entry for each period and set of hosts. */
const PERIOD = "7d";

/** Read again every minute while the page is open, and when the window gets focus back. */
const REFRESH_MS = 60_000;

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
  // The data scope (#126): Home adds up only the hosts in it; a host no longer there means all,
  // once the host list is read (before, a kept host is only not listed yet, and Home asks nobody).
  const kept = useSyncExternalStore(store.dataScope.subscribe, () => store.dataScope.value);
  const scope = activeScope(kept, state.hosts, state.hostsLoaded);
  const hosts = useMemo(() => scopeHosts(state.hosts, scope), [state.hosts, scope]);
  /** The scoped host, when it is offline (not still connecting): Home says so and offers all. */
  const away =
    scope.kind === "host"
      ? hosts.find((host) => host.status !== "online" && host.status !== "connecting")
      : undefined;
  /** The subtitle says whose numbers they are, as the scope menu does. */
  const scoped = scope.kind === "host" ? hosts[0]?.name : undefined;
  // A kept host not listed yet has no name: the subtitle names no scope rather than "all hosts".
  const subtitle = (() => {
    if (scope.kind === "all") return t("home.range");
    return scoped ? t("home.rangeHost", { host: scoped }) : t("home.rangeDays");
  })();
  const online = hosts.filter((host) => host.status === "online");
  const key = online.map((host) => host.id).join(",");
  /** The cache's entry: every host of the set, whether it is online now or not. */
  const entry = homeKey(
    PERIOD,
    hosts.map((host) => host.id),
  );
  const range = periodRange(PERIOD, store.today());
  const days = useMemo(() => daysBetween(range.from, range.to), [range.from, range.to]);
  /** The last read of this visit: what it found, and which hosts answered. */
  const [fetched, setFetched] = useState<{
    entry: string;
    hosts: HomeSnapshot;
    answered: string[];
    /** Hosts of the set that had numbers from an earlier read. */
    kept: string[];
    /** Online hosts that did not answer. */
    failed: string[];
  } | null>(null);
  const [tick, setTick] = useState(0);
  /** The leaderboard of the last read: in memory only, since it names projects (#124). */
  // `leaders` is null after a read in which a host with costs did not give all of them.
  const [leaders, setLeaders] = useState<{ entry: string; leaders: HomeLeaders | null } | null>(
    null,
  );
  // What is on screen at once: this visit's read, or else the last one of the same hosts and period.
  const data = fetched?.entry === entry ? fetched.hosts : (store.homeCache.get(entry) ?? null);

  // The numbers move with every turn: read again on a timer and when the window comes back.
  useEffect(() => {
    const again = () => setTick((n) => n + 1);
    const timer = setInterval(again, props.refreshMs ?? REFRESH_MS);
    window.addEventListener("focus", again);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", again);
    };
  }, [props.refreshMs]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: asked again when the hosts, the day or the tick change
  useEffect(() => {
    if (online.length === 0) return;
    let current = true;
    void Promise.all(
      online.map(async (host) => {
        const priced = hasFeature(host.hostInfo?.features, "costs", false);
        // The leaderboard's trend compares days 1-3 with days 4-6: today is not over.
        const half = (from: number, to: number) =>
          priced
            ? store.hostRequest(host.id, "costs.summary", {
                from: days[from] ?? range.from,
                to: days[to] ?? range.to,
              })
            : null;
        const [costs, usage, first, second] = await Promise.all([
          priced ? store.hostRequest(host.id, "costs.summary", range) : null,
          store.hostRequest(host.id, "usage.summary", { days: 7 }),
          half(0, 2),
          half(3, 5),
        ]);
        // A host that has costs but did not give them, or did not give its usage, did not answer.
        const answered = (costs === null || costs.ok) && usage.ok;
        return {
          id: host.id,
          priced,
          answered,
          // A host whose three costs came is in the leaderboard; the others are in the notices.
          shares:
            costs?.ok && first?.ok && second?.ok
              ? { week: costs.data, first: first.data, second: second.data }
              : null,
          data: homeHostData(
            costs?.ok ? costs.data : null,
            usage.ok ? usage.data : null,
            store.now(),
          ),
        };
      }),
    ).then((results) => {
      if (!current) return;
      // A host that did not answer keeps the numbers it had, and the hosts that are offline too.
      const before = store.homeCache.get(entry) ?? {};
      const hosts: HomeSnapshot = { ...before };
      for (const result of results) {
        if (result.answered || !before[result.id]) hosts[result.id] = result.data;
      }
      store.homeCache.set(entry, hosts);
      const shares = results.flatMap((r) => (r.shares ? [{ hostId: r.id, ...r.shares }] : []));
      const merged = (part: "week" | "first" | "second") =>
        mergeSummaries(
          shares.map((s) => ({ hostId: s.hostId, summary: s[part] })),
          range.from,
          range.to,
        ).summary;
      // Shares from only some hosts would read as the whole: until every host with costs gave
      // its three answers, the last whole leaderboard of these hosts stays, or the panel says so.
      const priced = results.filter((r) => r.priced);
      if (priced.length > 0 && shares.length === priced.length) {
        setLeaders({
          entry,
          leaders: homeLeaders(merged("week"), merged("first"), merged("second")),
        });
      } else {
        setLeaders((last) =>
          last?.entry === entry && last.leaders ? last : { entry, leaders: null },
        );
      }
      setFetched({
        entry,
        hosts,
        answered: results.filter((r) => r.answered).map((r) => r.id),
        kept: Object.keys(before),
        failed: results.filter((r) => !r.answered).map((r) => r.id),
      });
    });
    return () => {
      current = false;
    };
  }, [store, entry, key, range.from, range.to, tick]);

  const kpis: HomeKpis | null = useMemo(() => {
    if (!data) return null;
    const answers = Object.values(data);
    return homeKpis({
      days,
      costs: answers.flatMap((a) => (a.costs ? [a.costs] : [])),
      usage: answers.flatMap((a) => (a.usage ? [a.usage] : [])),
      budgets: hosts.flatMap((host) => state.budgets[host.id] ?? []),
    });
  }, [data, days, state.budgets, hosts]);
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
  const message = (() => {
    if (kpis) return t("home.ready");
    if (away && !connecting) return t("scope.offline", { host: away.name });
    if (online.length === 0) return connecting ? t("home.connecting") : t("home.noHosts");
    return t("home.loading");
  })();
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
  const labels = projectLabels(shown?.project.flatMap((row) => (row.key ? [row.key] : [])) ?? []);
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
        state.hostsLoaded && state.hosts.length > 1 ? (
          <ScopeMenu store={store} hosts={state.hosts} scope={scope} />
        ) : undefined
      }
    >
      {/* One live region from the first word to the numbers: its change is what is announced. */}
      <p
        role="status"
        aria-busy={busy ? true : undefined}
        className={kpis ? "sr-only" : "text-muted-foreground text-sm"}
      >
        {message}
      </p>
      {away && (
        <InlineNotice tone="info">
          {/* Without numbers the line above says it; with older numbers on screen, this one does. */}
          {kpis && <span>{t("scope.offline", { host: away.name })} </span>}
          <Button variant="outline" size="sm" onClick={() => store.dataScope.set(ALL_SCOPE)}>
            {t("scope.showAll")}
          </Button>
        </InlineNotice>
      )}
      {kpis && (
        <Stack gap={4}>
          <p className="text-muted-foreground text-xs">{t("home.updated", { ago })}</p>
          {stale.length > 0 && (
            <InlineNotice tone="info">
              {t("home.stale", { hosts: stale.map((h) => h.name).join(", "), ago })}
            </InlineNotice>
          )}
          {silent.length > 0 && (
            <InlineNotice>
              {t("home.partial", { hosts: silent.map((h) => h.name).join(", ") })}
            </InlineNotice>
          )}
          {kpis.turns.failed === null && (
            <InlineNotice tone="info">{t("home.olderDaemon")}</InlineNotice>
          )}
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
              onOpenProject={openProject}
            />
          )}
        </Stack>
      )}
    </Page>
  );
}
