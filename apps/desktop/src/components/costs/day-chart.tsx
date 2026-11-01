import { Inline } from "@/components/layout/stack";
import { useT } from "@/i18n/context";
import { cn } from "@/lib/utils";
import { formatDay } from "../../i18n/format.ts";
import { projectLabel, usd } from "../../lib/costs.ts";

/** A tint of the accent per project in a day's bar, so the stack reads. */
const SEGMENTS = ["bg-brand", "bg-brand/70", "bg-brand/50", "bg-brand/35"];

/** Days that fit a label each; over it only every few-th day gets one. */
const LABELLED = 7;

/**
 * The cost per day as bars stacked by project: the day under each bar, the total of a day as
 * the bar's text, the highest day and a legend of the projects. A project keeps its tint on
 * every day and in the legend; with more projects than tints the biggest spenders get one each
 * and the rest share the last, which the legend calls "other projects".
 */
export function DayChart(props: {
  days: string[];
  byDay: Array<{ day: string; projectKey: string; costUsd: number }>;
  /** The projects of the period, the biggest spender first. */
  projects: string[];
}) {
  const t = useT();
  const { days, byDay, projects } = props;
  const totals = new Map<string, number>();
  for (const row of byDay) totals.set(row.day, (totals.get(row.day) ?? 0) + row.costUsd);
  const highest = Math.max(0, ...totals.values());
  const tinted = projects.length <= SEGMENTS.length ? projects.length : SEGMENTS.length - 1;
  const tintOf = (projectKey: string) =>
    Math.min(Math.max(projects.indexOf(projectKey), 0), tinted);
  const legend = projects.length > tinted ? [...projects.slice(0, tinted), null] : projects;
  const labelEvery = Math.ceil(days.length / LABELLED);
  const dayText = (day: string) => `${day}: ${usd(totals.get(day) ?? 0)}`;
  return (
    <>
      <div className="flex h-40 items-end gap-1">
        {days.map((day) => (
          // biome-ignore lint/a11y/useSemanticElements: a column of the chart, not a form group
          <div
            key={day}
            data-day={day}
            role="group"
            aria-label={dayText(day)}
            title={dayText(day)}
            className="flex h-full min-w-2 flex-1 flex-col justify-end"
          >
            {byDay
              .filter((row) => row.day === day)
              .map((row) => (
                <div
                  key={row.projectKey}
                  data-project={row.projectKey}
                  role="img"
                  aria-label={`${day} · ${projectLabel(row.projectKey)}: ${usd(row.costUsd)}`}
                  className={cn(
                    "border-card border-t first:rounded-t-sm",
                    SEGMENTS[tintOf(row.projectKey)],
                  )}
                  style={{ height: `${highest > 0 ? (row.costUsd / highest) * 100 : 0}%` }}
                />
              ))}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-muted-foreground text-xs tabular-nums" aria-hidden>
        {days.map((day, i) => (
          <span key={day} data-day-label className="min-w-2 flex-1 text-center">
            {i % labelEvery === 0 ? formatDay(day, t.lang) : ""}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <Inline as="ul" label={t("costsUi.legend")} gap={4}>
          {legend.map((projectKey) => (
            <li key={projectKey ?? "other"} className="flex items-center gap-1.5">
              <span
                data-swatch
                className={cn(
                  "size-2.5 rounded-sm",
                  SEGMENTS[projectKey === null ? tinted : tintOf(projectKey)],
                )}
              />
              {projectKey === null ? t("costsUi.otherProjects") : projectLabel(projectKey)}
            </li>
          ))}
        </Inline>
        <span className="text-muted-foreground tabular-nums">
          {t("costsUi.highestDay", { value: usd(highest) })}
        </span>
      </div>
    </>
  );
}
