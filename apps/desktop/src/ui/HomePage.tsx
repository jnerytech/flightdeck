import type { CostsSummary, UsageSummary } from "@flightdeck/protocol";
import { useEffect, useMemo, useState } from "react";
import { KpiCard } from "@/components/home/kpi-card";
import { Page } from "@/components/layout/page";
import { Grid, Stack } from "@/components/layout/stack";
import { formatCompact, formatNumber, formatSeconds, formatUsd } from "@/i18n/format";
import type { AppState, AppStore } from "../lib/app-store.ts";
import { ALL_HOSTS, daysBetween, periodRange } from "../lib/costs.ts";
import { type HomeKpis, homeKpis } from "../lib/home-kpis.ts";
import type { Route } from "../lib/router.ts";
import { hasFeature } from "../lib/version.ts";

interface HostData {
  costs: CostsSummary | null;
  usage: UsageSummary | null;
}

/** Read again every minute while the page is open, and when the window gets focus back. */
const REFRESH_MS = 60_000;

/**
 * Home: the last seven days of every online host in four cards (spend, turns, tokens, the average
 * turn), from the hosts' own costs and usage; no command of its own.
 */
export function HomePage(props: {
  store: AppStore;
  state: AppState;
  go(route: Route): void;
  /** How often the numbers are read again, in milliseconds (a minute). */
  refreshMs?: number;
}) {
  const { store, state, go } = props;
  const { t, lang } = store.i18n;
  const online = state.hosts.filter((host) => host.status === "online");
  const key = online.map((host) => host.id).join(",");
  const range = periodRange("7d", store.today());
  const days = useMemo(() => daysBetween(range.from, range.to), [range.from, range.to]);
  const [data, setData] = useState<Record<string, HostData> | null>(null);
  /** Hosts that refused or did not answer the last read. */
  const [silent, setSilent] = useState<string[]>([]);
  const [tick, setTick] = useState(0);

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
    let current = true;
    void Promise.all(
      online.map(async (host) => {
        const [costs, usage] = await Promise.all([
          hasFeature(host.hostInfo?.features, "costs", false)
            ? store.hostRequest(host.id, "costs.summary", range)
            : null,
          store.hostRequest(host.id, "usage.summary", { days: 7 }),
        ]);
        const entry: HostData = {
          costs: costs?.ok ? costs.data : null,
          usage: usage.ok ? usage.data : null,
        };
        // A host that has costs but did not give them, or did not give its usage, did not answer.
        const answered = (costs === null || costs.ok) && usage.ok;
        return { id: host.id, name: host.name, entry, answered };
      }),
    ).then((entries) => {
      if (!current) return;
      setData(Object.fromEntries(entries.map((e) => [e.id, e.entry])));
      setSilent(entries.filter((e) => !e.answered).map((e) => e.name));
    });
    return () => {
      current = false;
    };
  }, [store, key, range.from, range.to, tick]);

  const kpis: HomeKpis | null = useMemo(() => {
    if (!data) return null;
    const answers = Object.values(data);
    return homeKpis({
      days,
      costs: answers.flatMap((a) => (a.costs ? [a.costs] : [])),
      usage: answers.flatMap((a) => (a.usage ? [a.usage] : [])),
      budgets: Object.values(state.budgets).flat(),
    });
  }, [data, days, state.budgets]);

  const usdOf = (value: number) => formatUsd(value, lang);
  const unknown = t("home.unknown");
  const series = (card: string, values: number[], format: (v: number) => string) =>
    t("home.chart", { card, values: values.map(format).join(", ") });
  // At start the hosts are still connecting: that is not "no host".
  const connecting = !state.hostsLoaded || state.hosts.some((host) => host.status === "connecting");
  const busy = online.length === 0 ? connecting : !kpis;
  const message =
    online.length === 0
      ? connecting
        ? t("home.connecting")
        : t("home.noHosts")
      : !kpis
        ? t("home.loading")
        : t("home.ready");
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
  const openTurns = () => {
    const only = online.length === 1 ? online[0] : undefined;
    if (only) go({ name: "history", host: only.id, from: range.from, to: range.to });
    else if (online.length > 1) openCosts();
  };

  return (
    <Page title={t("home.title")} subtitle={t("home.range")}>
      {/* One live region from the first word to the numbers: its change is what is announced. */}
      <p
        role="status"
        aria-busy={busy ? true : undefined}
        className={kpis && online.length > 0 ? "sr-only" : "text-muted-foreground text-sm"}
      >
        {message}
      </p>
      {online.length === 0 || !kpis
        ? null
        : kpis && (
            <Stack gap={4}>
              {silent.length > 0 && (
                <p aria-live="polite" className="text-sm">
                  {t("home.partial", { hosts: silent.join(", ") })}
                </p>
              )}
              {kpis.turns.failed === null && (
                <p className="text-muted-foreground text-sm">{t("home.olderDaemon")}</p>
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
                  seriesLabel={series(t("home.turns"), kpis.turns.series, (v) =>
                    formatNumber(v, lang),
                  )}
                  onOpen={openTurns}
                />
                <KpiCard
                  title={t("home.tokens")}
                  openLabel={t("home.openCard", { card: t("home.tokens") })}
                  value={
                    kpis.tokens.total === null ? unknown : formatCompact(kpis.tokens.total, lang)
                  }
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
                    kpis.average.costPerTurnUsd === null
                      ? unknown
                      : usdOf(kpis.average.costPerTurnUsd)
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
            </Stack>
          )}
    </Page>
  );
}
