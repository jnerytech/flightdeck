import { useState } from "react";
import { ActivityCardView } from "@/components/activity/activity-card";
import { ActivityColumnView } from "@/components/activity/activity-column";
import { NativeSelect } from "@/components/layout/form";
import { Page } from "@/components/layout/page";
import { EmptyState } from "@/components/layout/states";
import { Input } from "@/components/ui/input";
import { useBoardTransition } from "@/hooks/use-board-transition";
import type { Key } from "../i18n/index.ts";
import {
  ACTIVITY_COLUMNS,
  type ActivityFilter,
  activityBoard,
  activityOptions,
  NO_ACTIVITY_FILTER,
} from "../lib/activity.ts";
import type { AppState, AppStore } from "../lib/app-store.ts";
import type { HubRow } from "../lib/hub.ts";
import type { Route } from "../lib/router.ts";

/**
 * Every live session of every host by state: Needs you, Working, Done and (when asked for) Idle.
 * The screen to leave open on a second monitor.
 */
export function ActivityBoard(props: {
  store: AppStore;
  state: AppState;
  go(route: Route): void;
  onOpen(row: HubRow, newTab: boolean): void;
  /** Test seam: the hold time of a high-risk approval. */
  holdMs?: number;
}) {
  const { store, state } = props;
  const { t } = store.i18n;
  const [filter, setFilter] = useState<ActivityFilter>(NO_ACTIVITY_FILTER);
  const [showIdle, setShowIdle] = useState(() => store.activityIdle());
  const nowMs = store.now();
  const data = activityBoard(state, nowMs, filter, showIdle);
  const options = activityOptions(state);
  const signature = ACTIVITY_COLUMNS.flatMap((column) =>
    data.columns[column].map((card) => `${card.row.key}:${column}`),
  ).join("|");
  const shown = useBoardTransition(data, signature);
  const columns = ACTIVITY_COLUMNS.filter((column) => showIdle || column !== "idle");
  const set = (patch: Partial<ActivityFilter>) => setFilter({ ...filter, ...patch });
  return (
    <Page
      title={t("activityBoard.title")}
      toolbar={
        <div className="activity-toolbar">
          <Input
            type="search"
            aria-label={t("activityBoard.search")}
            placeholder={t("activityBoard.searchPlaceholder")}
            className="activity-search"
            value={filter.text}
            onChange={(e) => set({ text: e.target.value })}
          />
          <NativeSelect
            compact
            inline
            aria-label={t("activityBoard.host")}
            value={filter.host}
            onChange={(e) => set({ host: e.target.value })}
          >
            <option value="">{t("activityBoard.allHosts")}</option>
            {options.hosts.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            compact
            inline
            aria-label={t("activityBoard.project")}
            value={filter.project}
            onChange={(e) => set({ project: e.target.value })}
          >
            <option value="">{t("activityBoard.allProjects")}</option>
            {options.projects.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </NativeSelect>
          {options.personas.length > 0 && (
            <NativeSelect
              compact
              inline
              aria-label={t("activityBoard.persona")}
              value={filter.persona}
              onChange={(e) => set({ persona: e.target.value })}
            >
              <option value="">{t("activityBoard.allPersonas")}</option>
              {options.personas.map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.name}
                </option>
              ))}
            </NativeSelect>
          )}
          <label className="activity-idle hit-control">
            <input
              type="checkbox"
              checked={showIdle}
              onChange={(e) => {
                setShowIdle(e.target.checked);
                store.setActivityIdle(e.target.checked);
              }}
            />
            {t("activityBoard.showIdle")}
          </label>
          <output className="activity-shown">
            {t("activityBoard.shown", { n: data.shown, m: data.total })}
          </output>
        </div>
      }
    >
      {data.total === 0 && filter === NO_ACTIVITY_FILTER && !showIdle && state.hosts.length > 0 ? (
        <EmptyState title={t("activityBoard.emptyAll")} />
      ) : null}
      <div className="activity-board">
        {columns.map((column) => (
          <ActivityColumnView
            key={column}
            name={t(`activityBoard.columns.${column}` as Key)}
            count={shown.columns[column].length}
            none={t("activityBoard.none")}
          >
            {shown.columns[column].map((card) => (
              <ActivityCardView
                key={card.row.key}
                card={card}
                t={t}
                nowMs={nowMs}
                {...(props.holdMs !== undefined ? { holdMs: props.holdMs } : {})}
                onOpen={(newTab) => props.onOpen(card.row, newTab)}
                onRespond={(decision) =>
                  card.pending
                    ? store.respondTo(card.pending.hostId, card.pending.requestId, decision)
                    : undefined
                }
              />
            ))}
          </ActivityColumnView>
        ))}
      </div>
    </Page>
  );
}
