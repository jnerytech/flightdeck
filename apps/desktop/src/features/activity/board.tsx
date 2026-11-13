import { useEffect, useReducer, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import type { HubRow } from "@/features/sessions/index.ts";
import { useStoreSlice } from "@/lib/use-store";
import { EmptyState, NativeSelect, Page } from "@/shared/layout/index.ts";
import type { Key } from "../../i18n/index.ts";
import type { AppStore, PendingItem } from "../../lib/app-store.ts";
import type { Route } from "../../lib/router.ts";
import {
  ACTIVITY_COLUMNS,
  ACTIVITY_KEYS,
  type ActivityCard,
  type ActivityFilter,
  activityBoard,
  activityOptions,
  NO_ACTIVITY_FILTER,
} from "./activity.ts";
import { ActivityCardView } from "./activity-card.tsx";
import { ActivityColumnView } from "./activity-column.tsx";
import { useBoardTransition } from "./use-board-transition.ts";

/** How often the board reads the clock again. */
const CLOCK_TICK_MS = 30_000;

/**
 * Every live session of every host by state: Needs you, Working, Done and (when asked for) Idle.
 * The screen to leave open on a second monitor.
 */
export function ActivityBoard(
  props: Readonly<{
    store: AppStore;
    go(route: Route): void;
    onOpen(row: HubRow, newTab: boolean): void;
    /** Test seam: the hold time of a high-risk approval. */
    holdMs?: number;
    /** Test seam: how often the board reads the clock again. */
    tickMs?: number;
  }>,
) {
  const { store } = props;
  const state = useStoreSlice(store, ACTIVITY_KEYS);
  const { t } = store.i18n;
  const [filter, setFilter] = useState<ActivityFilter>(NO_ACTIVITY_FILTER);
  const [showIdle, setShowIdle] = useState(() => store.viewPrefs.activityIdle());
  // The screen stays open for hours: the ages and the Done window follow the clock.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const id = setInterval(rerender, props.tickMs ?? CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, [props.tickMs]);
  const nowMs = store.now();
  const data = activityBoard(state, nowMs, filter, showIdle);
  const options = activityOptions(state);
  const signature = ACTIVITY_COLUMNS.flatMap((column) =>
    data.columns[column].map((card) => `${card.row.key}:${column}`),
  ).join("|");
  const shown = useBoardTransition(data, signature);
  const columns = ACTIVITY_COLUMNS.filter((column) => showIdle || column !== "idle");
  // #2675: an answer removes the request block (and the card may change column), so the focus goes
  // back to the card's title and the board says what was answered.
  const titles = useRef(new Map<string, HTMLButtonElement>());
  const focusAfter = useRef<string | null>(null);
  const [said, setSaid] = useState("");
  useEffect(() => {
    const key = focusAfter.current;
    if (key === null) return;
    const card = ACTIVITY_COLUMNS.flatMap((column) => shown.columns[column]).find(
      (item) => item.row.key === key,
    );
    if (!card) {
      focusAfter.current = null;
      return;
    }
    // Only a focus that fell to the page is put back: one the person moved is left where it is.
    if (document.activeElement === document.body) titles.current.get(key)?.focus();
    if (!card.pending) focusAfter.current = null;
  });
  const answer = (
    card: ActivityCard,
    request: PendingItem,
    decision: "allow" | "deny",
    held: boolean | undefined,
  ) => {
    focusAfter.current = card.row.key;
    titles.current.get(card.row.key)?.focus();
    const sent = store.respondTo(request.hostId, request.requestId, decision, held ? { held } : {});
    const key = decision === "allow" ? "activityBoard.approved" : "activityBoard.denied";
    return Promise.resolve(sent).then(() => setSaid(t(key, { title: card.row.title })));
  };
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
                store.viewPrefs.setActivityIdle(e.target.checked);
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
      {data.total === 0 && state.hosts.length > 0 ? (
        <EmptyState title={t("activityBoard.emptyAll")} />
      ) : null}
      <output className="sr-only">{said}</output>
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
                titleRef={(button) => {
                  if (button) titles.current.set(card.row.key, button);
                  else titles.current.delete(card.row.key);
                }}
                onRespond={(request, decision, held) => answer(card, request, decision, held)}
              />
            ))}
          </ActivityColumnView>
        ))}
      </div>
    </Page>
  );
}
