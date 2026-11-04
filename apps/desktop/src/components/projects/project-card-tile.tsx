import type { AppStore } from "../../lib/app-store.ts";
import { usd } from "../../lib/costs.ts";
import type { ProjectCard } from "../../lib/project-cards.ts";

/** One project as a card: its name, host, branch, live sessions, last activity and the week's cost. */
export function ProjectCardTile(props: { store: AppStore; card: ProjectCard; onOpen(): void }) {
  const { store, card } = props;
  const { t } = store.i18n;
  return (
    <li data-project={card.name}>
      <button
        type="button"
        aria-label={t("projectsOverview.open", { name: card.name, host: card.hostName })}
        className="card-button rounded-lg border bg-card text-left hover:bg-accent/40 focus-visible:ring-2"
        onClick={props.onOpen}
      >
        <span className="row-spread">
          <span className="truncate font-medium">{card.name}</span>
          <span className="text-muted-foreground text-xs">{card.hostName}</span>
        </span>
        <span className="text-muted-foreground text-xs">{card.branch}</span>
        <span className="facts-wrap text-sm">
          <span>{t("projectsOverview.live", { n: card.liveSessions })}</span>
          <span>{t("projectsOverview.inProgress", { n: card.inProgress })}</span>
          <span className={card.needsYou > 0 ? "font-medium text-status-needs-you" : ""}>
            {t("projectsOverview.needsYou", { n: card.needsYou })}
          </span>
        </span>
        <span className="row-spread text-muted-foreground text-xs">
          <span title={card.lastActivity ? store.formatDateTime(card.lastActivity) : ""}>
            {card.lastActivity
              ? `${t("projectsOverview.lastActivity")}: ${store.formatWhen(card.lastActivity)}`
              : t("projectsOverview.noActivity")}
          </span>
          <span title={t("projectsOverview.costWeek")}>
            {card.costWeekUsd === null ? t("projectsOverview.noCost") : usd(card.costWeekUsd)}
          </span>
        </span>
      </button>
    </li>
  );
}
