import { ArrowDownRight, ArrowUpRight, Minus, Sparkle } from "lucide-react";
import { useId } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCompact, formatNumber } from "@/i18n/format";
import type { Lang, T } from "../../i18n/index.ts";
import {
  type HomeLeaders,
  type LeaderRow,
  sharePercent,
  type Trend,
} from "../../lib/home-leaders.ts";

const DIMENSIONS = [
  { id: "project", tab: "home.byProject" },
  { id: "model", tab: "home.byModel" },
  { id: "persona", tab: "home.byPersona" },
] as const;

const TREND_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus, new: Sparkle } as const;

/**
 * Where the tokens of the 7 days went, by project, model and persona (#124): each row says its
 * share, its tokens and its trend in words, so neither the bar nor a color carries the meaning
 * alone. A project opens Costs on that project.
 */
export function Leaderboard(
  props: Readonly<{
    t: T;
    lang: Lang;
    /** `null` until the hosts answered: the names are never kept, so there is nothing to show before. */
    leaders: HomeLeaders | null;
    projectName(key: string): string;
    onOpenProject(key: string): void;
  }>,
) {
  const { t, lang, leaders } = props;
  const id = useId();
  const empty = leaders !== null && DIMENSIONS.every(({ id: d }) => leaders[d].length === 0);

  const trendText = (trend: Trend) => {
    const n = formatNumber(trend.percent ?? 0, lang);
    if (trend.direction === "up") return t("home.trendUp", { n });
    if (trend.direction === "down") return t("home.trendDown", { n });
    return trend.direction === "new" ? t("home.trendNew") : t("home.trendFlat");
  };
  const shareText = (share: number) => {
    const percent = sharePercent(share);
    return percent === null ? t("home.underOne") : `${formatNumber(percent, lang)}%`;
  };
  const name = (dimension: (typeof DIMENSIONS)[number]["id"], row: LeaderRow) => {
    if (row.others > 0) return t("home.others", { n: formatNumber(row.others, lang) });
    if (row.key === null) return t("home.noPersona");
    return dimension === "project" ? props.projectName(row.key) : row.key;
  };

  return (
    <section aria-labelledby={id} className="leader-panel">
      <h2 id={id} className="leader-title">
        {t("home.leaders")}
      </h2>
      <p className="leader-hint">{t("home.leadersHint")}</p>
      {leaders === null && <p className="leader-hint">{t("home.loading")}</p>}
      {empty && <p className="leader-hint">{t("home.noTokens")}</p>}
      {leaders !== null && !empty && (
        <Tabs defaultValue="project">
          <TabsList aria-label={t("home.leadersBy")}>
            {DIMENSIONS.map(({ id: d, tab }) => (
              <TabsTrigger key={d} value={d}>
                {t(tab)}
              </TabsTrigger>
            ))}
          </TabsList>
          {DIMENSIONS.map(({ id: d }) => (
            <TabsContent key={d} value={d}>
              <ol className="leader-list">
                {leaders[d].map((row) => {
                  const label = name(d, row);
                  const Icon = TREND_ICON[row.trend.direction];
                  const project = d === "project" && row.others === 0 ? row.key : null;
                  return (
                    <li key={`${row.key}|${row.others}`} className="leader-row">
                      {project === null ? (
                        <span className="leader-name" title={label}>
                          {label}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="leader-name leader-link"
                          title={label}
                          aria-label={t("home.openProject", { name: label })}
                          onClick={() => props.onOpenProject(project)}
                        >
                          {label}
                        </button>
                      )}
                      <span className="leader-bar" aria-hidden="true">
                        <span style={{ width: `${row.share * 100}%` }} />
                      </span>
                      <span className="leader-share">{shareText(row.share)}</span>
                      <span className="leader-tokens">
                        {t("home.tokensOf", { n: formatCompact(row.tokens, lang) })}
                      </span>
                      <span className="leader-trend">
                        <Icon aria-hidden="true" />
                        <span>{trendText(row.trend)}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </section>
  );
}
