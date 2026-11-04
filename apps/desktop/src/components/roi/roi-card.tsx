import type { Project, RoiPeriod } from "@flightdeck/protocol";
import { useCallback, useEffect, useId, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { Key } from "@/i18n/index";
import type { AppStore } from "@/lib/app-store";
import { periodRange, usd } from "@/lib/costs";
import { compare, EMPTY_PERIOD, figures, headline, mergePeriods } from "@/lib/roi";

type Choice = "month" | "7d" | "30d";
const CHOICES: Array<{ id: Choice; label: Key }> = [
  { id: "7d", label: "roiUi.period7" },
  { id: "30d", label: "roiUi.period30" },
  { id: "month", label: "roiUi.periodMonth" },
];
const REFRESH_MS = 30_000;

/**
 * The ROI card of a project (phase 36). It leads with whether more was delivered for what it cost;
 * the money (rates, plan price) is the app's, the counts come from the hosts. What is an estimate
 * says so, and every figure can show how it was made.
 */
export function RoiCard(props: { store: AppStore; hostId: string; project: Project }) {
  const { store, project } = props;
  const t = useT();
  const [choice, setChoice] = useState<Choice>("month");
  const [periods, setPeriods] = useState<{ current: RoiPeriod; previous: RoiPeriod } | null>(null);
  const [answered, setAnswered] = useState(0);
  const [how, setHow] = useState(false);
  const [hours, setHours] = useState(
    project.defaultHours === null ? "" : String(project.defaultHours),
  );
  const hoursId = useId();
  const rateId = useId();
  const key = project.projectKey ?? project.path;
  const [rateText, setRateText] = useState(() => {
    const own = store.roi.data().projectRates[key];
    return own === undefined ? "" : String(own);
  });
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    const { from, to } = periodRange(choice, store.today());
    const answers = await store.roiSummaries(from, to);
    const found = answers.flatMap(({ result }) =>
      result.projects.filter((p) => p.projectKey === key),
    );
    setAnswered(answers.length);
    setPeriods({
      current: mergePeriods(found.map((p) => p.current)),
      previous: mergePeriods(found.map((p) => p.previous)),
    });
  }, [store, choice, key]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Cheap, and read on every render: saving a rate bumps `version` to render again.
  const money = store.roiMoneyOf(key);

  if (!periods) {
    return (
      <section aria-label={t("roiUi.title")} className="rounded-lg border bg-card p-4 text-sm">
        {t("roiUi.loading")}
      </section>
    );
  }
  if (answered === 0) {
    return (
      <section aria-label={t("roiUi.title")} className="rounded-lg border bg-card p-4 text-sm">
        {t("roiUi.noHost")}
      </section>
    );
  }
  const now = periods.current ?? EMPTY_PERIOD;
  const f = figures(now, money);
  const verdict = compare(now, periods.previous);
  const line = headline(now, periods.previous);
  const movedText = t(`roiUi.moved.${verdict.costPerItemMoved ?? "none"}` as Key);
  const weekCards = now.weeks.map((w) => w.cards);
  const maxWeek = Math.max(1, ...weekCards);

  const saveHours = async () => {
    const parsed = hours.trim() === "" ? null : Number(hours);
    if (parsed !== null && !Number.isFinite(parsed)) return;
    await store.hostCommand(props.hostId, "project.update", {
      projectId: project.id,
      defaultHours: parsed,
    });
    await load();
  };
  const saveRate = () => {
    const parsed = rateText.trim() === "" ? null : Number(rateText);
    if (parsed !== null && !Number.isFinite(parsed)) return;
    store.roi.setProjectRate(key, parsed);
    setVersion(version + 1);
  };

  return (
    <section
      aria-label={t("roiUi.title")}
      className="flex flex-col gap-3 rounded-lg border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium text-sm">{t("roiUi.title")}</h2>
        <fieldset aria-label={t("roiUi.period")} className="m-0 flex min-w-0 gap-1 border-0 p-0">
          {CHOICES.map((c) => (
            <Button
              key={c.id}
              size="sm"
              variant="outline"
              aria-pressed={choice === c.id}
              className="aria-pressed:bg-accent"
              onClick={() => setChoice(c.id)}
            >
              {t(c.label)}
            </Button>
          ))}
        </fieldset>
      </div>
      <p className="text-sm">{t(line.key as Key, { ...line.vars, movedText })}</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <li>{t("roiUi.cardsDone", { n: f.cards })}</li>
        <li>{t("roiUi.prsMerged", { n: f.prsMerged })}</li>
        <li>{t("roiUi.cost", { cost: usd(f.costUsd) })}</li>
        {f.costPerCard !== null && <li>{t("roiUi.costPerCard", { each: usd(f.costPerCard) })}</li>}
        {f.costPerPr !== null && <li>{t("roiUi.costPerPr", { each: usd(f.costPerPr) })}</li>}
        <li>
          {now.fixRounds > 0
            ? t("roiUi.rework", { rounds: now.fixRounds, cost: usd(now.fixCostUsd) })
            : t("roiUi.noRework")}
        </li>
      </ul>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <li className="flex items-center gap-1">
          <span>{t("roiUi.hours", { hours: f.hours })}</span>
          <Badge variant="outline">{t("roiUi.estimate")}</Badge>
        </li>
        {now.cardsWithoutEstimate > 0 && (
          <li>{t("roiUi.noEstimate", { n: now.cardsWithoutEstimate })}</li>
        )}
        {f.valueUsd !== null ? (
          <li className="flex items-center gap-1">
            <span>{t("roiUi.value", { value: usd(f.valueUsd) })}</span>
            <Badge variant="outline">{t("roiUi.estimate")}</Badge>
          </li>
        ) : (
          <li className="text-muted-foreground">{t("roiUi.noRate")}</li>
        )}
        {f.roi !== null && (
          <li className="flex items-center gap-1">
            <span>{t("roiUi.roi", { roi: f.roi.toFixed(1) })}</span>
            <Badge variant="outline">{t("roiUi.estimate")}</Badge>
          </li>
        )}
      </ul>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
        {now.decisions > 0 && (
          <li>{t("roiUi.waited", { hours: Math.round((now.waitedSeconds / 3600) * 10) / 10 })}</li>
        )}
        {now.approxCards > 0 && <li>{t("roiUi.approx", { n: now.approxCards })}</li>}
        {now.outsideCardsUsd > 0 && (
          <li>{t("roiUi.outside", { cost: usd(now.outsideCardsUsd) })}</li>
        )}
      </ul>
      <div>
        <p className="text-muted-foreground text-xs">{t("roiUi.trend")}</p>
        <div
          role="img"
          aria-label={t("roiUi.trendAlt", { list: weekCards.join(", ") })}
          className="flex h-10 items-end gap-1"
        >
          {weekCards.map((n, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: eight fixed weeks
              key={i}
              aria-hidden="true"
              className="w-3 bg-primary/70"
              style={{ height: `${Math.max(4, (n / maxWeek) * 100)}%` }}
            />
          ))}
        </div>
      </div>
      <div>
        <Button size="sm" variant="ghost" aria-expanded={how} onClick={() => setHow(!how)}>
          {t("roiUi.how")}
        </Button>
        {how && (
          <div className="flex flex-col gap-1 text-xs">
            <ul className="flex flex-col gap-1">
              {f.derivation.map((d) => (
                <li key={d.key}>{t(d.key as Key, d.vars)}</li>
              ))}
            </ul>
            <p className="text-muted-foreground">{t("roiUi.caveat")}</p>
          </div>
        )}
      </div>
      <details>
        <summary className="cursor-pointer text-sm">{t("roiUi.settings")}</summary>
        <div className="mt-2 flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1 text-xs">
            <label htmlFor={hoursId}>{t("roiUi.defaultHours")}</label>
            <Input
              id={hoursId}
              inputMode="decimal"
              className="h-8 w-28"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </div>
          <ActionButton size="sm" variant="outline" onClick={saveHours}>
            {t("roiUi.saveHours")}
          </ActionButton>
          <div className="flex flex-col gap-1 text-xs">
            <label htmlFor={rateId}>{t("roiUi.projectRate")}</label>
            <Input
              id={rateId}
              inputMode="decimal"
              className="h-8 w-28"
              value={rateText}
              onChange={(e) => setRateText(e.target.value)}
            />
          </div>
          <Button size="sm" variant="outline" onClick={saveRate}>
            {t("roiUi.saveRate")}
          </Button>
        </div>
      </details>
    </section>
  );
}
