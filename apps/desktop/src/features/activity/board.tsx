import { useEffect, useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HubRow } from "@/features/sessions/index.ts";
import { useStoreSlice } from "@/lib/use-store";
import { Spinner } from "@/shared/feedback/index.ts";
import { EmptyState, Inline, NativeSelect, Page } from "@/shared/layout/index.ts";
import type { Key } from "../../i18n/index.ts";
import type { AppStore, PendingItem } from "../../lib/app-store.ts";
import type { Route } from "../../lib/router.ts";
import { ActivityCardView } from "./activity-card.tsx";
import { ActivityColumnView } from "./activity-column.tsx";
import {
  ACTIVITY_COLUMNS,
  ACTIVITY_KEYS,
  type ActivityCard,
  type ActivityFilter,
  activityBoard,
  activityOptions,
  activityStage,
  NO_ACTIVITY_FILTER,
} from "./domain/activity.ts";
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
  // #2675: an answer removes the request block (and the card may change column). Once the request
  // is gone, the board says what was answered and, if the focus fell to the page, puts it back on
  // the card's title. A request that stays (the send failed, a high risk was not held) changes
  // nothing: the focus stays on the button and nothing is said.
  const titles = useRef(new Map<string, HTMLButtonElement>());
  const answered = useRef<{ key: string; requestId: string; said: string } | null>(null);
  const [said, setSaid] = useState("");
  useEffect(() => {
    const done = answered.current;
    if (!done) return;
    const card = ACTIVITY_COLUMNS.flatMap((column) => shown.columns[column]).find(
      (item) => item.row.key === done.key,
    );
    if (card?.pending?.requestId === done.requestId) return;
    answered.current = null;
    setSaid(done.said);
    if (card && document.activeElement === document.body) titles.current.get(done.key)?.focus();
  });
  // #4240: an answer that did not go through says why on its card, until the next answer or until
  // the request leaves. The focus stays on the button.
  const [failed, setFailed] = useState<{ key: string; requestId: string; reason: string } | null>(
    null,
  );
  const answer = async (
    card: ActivityCard,
    request: PendingItem,
    decision: "allow" | "deny",
    held: boolean | undefined,
  ) => {
    const key = decision === "allow" ? "activityBoard.approved" : "activityBoard.denied";
    // Cleared first, so the same words twice in a row are announced twice.
    setSaid("");
    answered.current = {
      key: card.row.key,
      requestId: request.requestId,
      said: t(key, { title: card.row.title }),
    };
    setFailed(null);
    const result = await store.respondTo(
      request.hostId,
      request.requestId,
      decision,
      held ? { held } : {},
    );
    if (!result.ok) {
      // The request stays, so nothing was answered: the later removal of it is not this answer.
      if (answered.current?.requestId === request.requestId) answered.current = null;
      setFailed({ key: card.row.key, requestId: request.requestId, reason: result.reason });
    }
    return result;
  };
  const stage = activityStage(state, data.total + data.hiddenIdle);
  const searchRef = useRef<HTMLInputElement>(null);
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
            ref={searchRef}
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
          {data.hiddenIdle > 0 && (
            <span className="activity-idle-hidden">
              {data.hiddenIdle === 1
                ? t("activityBoard.idleHiddenOne")
                : t("activityBoard.idleHidden", { n: data.hiddenIdle })}
            </span>
          )}
          <output className="activity-shown">
            {t("activityBoard.shown", { n: data.shown, m: data.total })}
          </output>
        </div>
      }
    >
      {stage === "loading" ? (
        <output className="block">
          <Inline>
            <Spinner />
            <span className="text-sm">{t("activityBoard.loading")}</span>
          </Inline>
        </output>
      ) : null}
      {stage === "board" && data.total === 0 && data.hiddenIdle === 0 ? (
        <EmptyState title={t("activityBoard.emptyAll")} />
      ) : null}
      {/* Filters that match no card: say so and offer the way back (#3967). The idle switch is a view
          choice, not a filter, so Clear filters leaves it. */}
      {data.shown === 0 && data.total > 0 ? (
        <EmptyState
          title={t("activityBoard.emptyFiltered")}
          action={
            <Button
              variant="link"
              onClick={() => {
                setFilter(NO_ACTIVITY_FILTER);
                // The empty state leaves with its button: keep the focus on the toolbar.
                searchRef.current?.focus();
              }}
            >
              {t("activityBoard.clearFilters")}
            </Button>
          }
        />
      ) : null}
      <output className="sr-only">{said}</output>
      {stage === "board" && (
        <div className="activity-board">
          {columns.map((column) => (
            <ActivityColumnView
              key={column}
              name={t(`activityBoard.columns.${column}` as Key)}
              count={shown.columns[column].length}
              none={t("activityBoard.none")}
              {...(column === "done" ? { hint: t("activityBoard.doneHint") } : {})}
            >
              {shown.columns[column].map((card) => (
                <ActivityCardView
                  key={card.row.key}
                  card={card}
                  t={t}
                  nowMs={nowMs}
                  {...(props.holdMs !== undefined ? { holdMs: props.holdMs } : {})}
                  {...(failed?.key === card.row.key && failed.requestId === card.pending?.requestId
                    ? { failure: t("activityBoard.answerFailed", { reason: failed.reason }) }
                    : {})}
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
      )}
    </Page>
  );
}
