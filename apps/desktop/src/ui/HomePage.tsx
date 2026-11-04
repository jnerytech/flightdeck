import type { CostsSummary, UsageSummary } from "@flightdeck/protocol";
import { useEffect, useMemo, useState } from "react";
import { KpiCard } from "@/components/home/kpi-card";
import { Page } from "@/components/layout/page";
import { Grid, Stack } from "@/components/layout/stack";
import { formatCompact, formatNumber, formatSeconds, formatUsd } from "@/i18n/format";
import type { AppState, AppStore } from "../lib/app-store.ts";
import { daysBetween, periodRange } from "../lib/costs.ts";
import { type HomeKpis, homeKpis } from "../lib/home-kpis.ts";
import type { Route } from "../lib/router.ts";
import { hasFeature } from "../lib/version.ts";

interface HostData {
  costs: CostsSummary | null;
  usage: UsageSummary | null;
}

/**
 * Home: the last seven days of every online host in four cards (spend, turns, tokens, the average
 * turn), from the hosts' own costs and usage; no command of its own.
 */
export function HomePage(props: { store: AppStore; state: AppState; go(route: Route): void }) {
  const { store, state, go } = props;
  const { t, lang } = store.i18n;
  const online = state.hosts.filter((host) => host.status === "online");
  const key = online.map((host) => host.id).join(",");
  const range = periodRange("7d", store.today());
  const days = useMemo(() => daysBetween(range.from, range.to), [range.from, range.to]);
  const [data, setData] = useState<Record<string, HostData> | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: asked again when the hosts or the day change
  useEffect(() => {
    let current = true;
    void Promise.all(
      online.map(async (host) => {
        const [costs, usage] = await Promise.all([
          hasFeature(host.hostInfo?.features, "costs", false)
            ? store.hostCommand(host.id, "costs.summary", range)
            : null,
          store.hostCommand(host.id, "usage.summary", { days: 7 }),
        ]);
        return [host.id, { costs, usage }] as const;
      }),
    ).then((entries) => {
      if (current) setData(Object.fromEntries(entries));
    });
    return () => {
      current = false;
    };
  }, [store, key, range.from, range.to]);

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
  const openCosts = () => go({ name: "costs" });
  const firstHost = online[0]?.id;

  return (
    <Page title={t("home.title")} subtitle={t("home.range")}>
      {online.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("home.noHosts")}</p>
      ) : (
        kpis && (
          <Stack gap={4}>
            <Grid cols={{ base: 1, sm: 2, xl: 4 }} gap={4}>
              <KpiCard
                title={t("home.spend")}
                openLabel={t("home.openCard", { card: t("home.spend") })}
                value={usdOf(kpis.spend.totalUsd)}
                details={
                  kpis.spend.budget
                    ? t("home.ofBudget", {
                        spent: usdOf(kpis.spend.budget.spentUsd),
                        limit: usdOf(kpis.spend.budget.limitUsd),
                      })
                    : t("home.noBudget")
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
                onOpen={() => (firstHost ? go({ name: "history", host: firstHost }) : undefined)}
              />
              <KpiCard
                title={t("home.tokens")}
                openLabel={t("home.openCard", { card: t("home.tokens") })}
                value={formatCompact(kpis.tokens.total, lang)}
                details={t("home.cacheRead", { n: formatCompact(kpis.tokens.cacheRead, lang) })}
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
        )
      )}
    </Page>
  );
}
