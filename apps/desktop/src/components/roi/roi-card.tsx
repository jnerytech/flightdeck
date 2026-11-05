import type { Project, RoiPeriod, RoiSignalValues } from "@flightdeck/protocol";
import { ChevronDown, ChevronUp } from "lucide-react";
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
import { useStoreSlice } from "@/lib/use-store";

/** The signals of the same project on several hosts: counts add up, the first refusal is told. */
function mergeSignals(list: Array<RoiSignalValues | undefined>): RoiSignalValues {
  const merged: RoiSignalValues = {};
  for (const signals of list) {
    if (!signals) continue;
    if (signals.agentCommits !== undefined) {
      merged.agentCommits = (merged.agentCommits ?? 0) + signals.agentCommits;
    }
    if (signals.issuesClosed !== undefined) {
      merged.issuesClosed = (merged.issuesClosed ?? 0) + signals.issuesClosed;
    }
    if (signals.issuesError && !merged.issuesError) merged.issuesError = signals.issuesError;
  }
  return merged;
}

type Choice = "month" | "7d" | "30d";
const CHOICES: Array<{ id: Choice; labelKey: Key }> = [
  { id: "7d", labelKey: "roiUi.period7" },
  { id: "30d", labelKey: "roiUi.period30" },
  { id: "month", labelKey: "roiUi.periodMonth" },
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
  // Issue #178: folded to its headline unless the person opened it (the choice is kept).
  const [open, setOpen] = useState(() => store.roiOpen());
  const flip = () => {
    store.saveRoiOpen(!open);
    setOpen(!open);
  };
  const [periods, setPeriods] = useState<{ current: RoiPeriod; previous: RoiPeriod } | null>(null);
  const [answered, setAnswered] = useState(0);
  const [signals, setSignals] = useState<RoiSignalValues>({});
  const [on, setOn] = useState(project.roiSignals);
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
  // The money is the app's own settings: a rate saved here or elsewhere shows at once.
  useStoreSlice(store, ["roiRevision"]);

  const load = useCallback(async () => {
    const { from, to } = periodRange(choice, store.roiToday());
    const answers = await store.roiSummaries(from, to);
    const found = answers.flatMap(({ result }) =>
      result.projects.filter((p) => p.projectKey === key),
    );
    setAnswered(answers.length);
    setSignals(mergeSignals(found.map((p) => p.signals)));
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

  // Cheap, and read on every render.
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
  const setSignal = async (name: "commits" | "issues", value: boolean) => {
    await store.hostCommand(props.hostId, "project.update", {
      projectId: project.id,
      roiSignals: { [name]: value },
    });
    setOn({ ...on, [name]: value });
    await load();
  };
  const saveRate = () => {
    const parsed = rateText.trim() === "" ? null : Number(rateText);
    if (parsed !== null && !Number.isFinite(parsed)) return;
    store.roi.setProjectRate(key, parsed);
  };

  return (
    <section
      aria-label={t("roiUi.title")}
      className="flex flex-col gap-3 rounded-lg border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium text-sm">{t("roiUi.title")}</h2>
        <Button size="sm" variant="ghost" aria-expanded={open} onClick={flip}>
          {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          {t("roiUi.details")}
        </Button>
      </div>
      {open && (
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
              {t(c.labelKey)}
            </Button>
          ))}
        </fieldset>
      )}
      <p className="text-sm">{t(line.key as Key, { ...line.vars, movedText })}</p>
      {open && (
        <>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <li>{t("roiUi.cardsDone", { n: f.cards })}</li>
            <li>{t("roiUi.prsMerged", { n: f.prsMerged })}</li>
            <li>{t("roiUi.cost", { cost: usd(f.costUsd) })}</li>
            {f.costPerCard !== null && (
              <li>{t("roiUi.costPerCard", { each: usd(f.costPerCard) })}</li>
            )}
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
              <li className="text-muted-foreground">
                {t(money.rate === null ? "roiUi.noRate" : "roiUi.noHours")}
              </li>
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
              <li>
                {t("roiUi.waited", { hours: Math.round((now.waitedSeconds / 3600) * 10) / 10 })}
              </li>
            )}
            {now.approxCards > 0 && <li>{t("roiUi.approx", { n: now.approxCards })}</li>}
            {signals.agentCommits !== undefined && (
              <li>{t("roiUi.signals.agentCommits", { n: signals.agentCommits })}</li>
            )}
            {signals.issuesClosed !== undefined && (
              <li>{t("roiUi.signals.issuesClosed", { n: signals.issuesClosed })}</li>
            )}
            {signals.issuesError && (
              <li>{t(`roiUi.signals.error.${signals.issuesError}` as Key)}</li>
            )}
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
                  // A week with no card is a faint baseline, not a bar (issue #183).
                  data-empty={n === 0 ? "true" : undefined}
                  className={n === 0 ? "w-3 bg-muted-foreground/25" : "w-3 bg-primary/70"}
                  style={{ height: n === 0 ? "2px" : `${Math.max(8, (n / maxWeek) * 100)}%` }}
                />
              ))}
            </div>
          </div>
          <div>
            {/* A link with no side padding: it lines up with the text above it (issue #183). */}
            <Button
              size="sm"
              variant="link"
              className="toggle-start h-auto px-0"
              aria-expanded={how}
              onClick={() => setHow(!how)}
            >
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
              <fieldset
                aria-label={t("roiUi.signals.title")}
                className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0 text-xs"
              >
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={on.commits}
                    onChange={(e) => void setSignal("commits", e.target.checked)}
                  />
                  {t("roiUi.signals.commits")}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={on.issues}
                    onChange={(e) => void setSignal("issues", e.target.checked)}
                  />
                  {t("roiUi.signals.issues")}
                </label>
              </fieldset>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
