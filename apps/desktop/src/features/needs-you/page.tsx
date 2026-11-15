import { CheckCheck, MousePointerClick } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { sessionProjectKeys } from "@/features/clients/index.ts";
import { hubRows, sinceLastLook } from "@/features/sessions/index.ts";
import { EmptyState, SplitView } from "@/shared/layout/index.ts";
import type { T } from "../../i18n/index.ts";
import { type AppState, type AppStore, needsYou, type PendingItem } from "../../lib/app-store.ts";
import type { Route } from "../../lib/router.ts";
import { awayView } from "../activity/index.ts";
import { budgetAlerts } from "../costs/index.ts";
import { loopPairKey } from "../messaging/index.ts";
import { typing } from "../shortcuts/index.ts";
import { watchAlerts } from "../watch/index.ts";
import { Detail } from "./details.tsx";
import { quietAlerts } from "./domain/quiet.ts";
import { type Entry, EntryRow, hostNameOf, ROW_PAD } from "./entry-row.tsx";
import { WhileAway } from "./while-away.tsx";

/** A key pressed on a control of the "While you were away" summary is that control's, not the list's. */
const inSummary = (target: EventTarget | null) =>
  (target as HTMLElement | null)?.closest?.("[data-slot='while-away']") != null;

const NOTE = `${ROW_PAD} text-muted-foreground text-sm`;
const HEADING = `${ROW_PAD} font-medium text-muted-foreground text-xs`;

/** Everything that waits for the person, in the list's order: budget alerts, loops, watches, requests. */
function entriesOf(state: AppState, t: T, nowMs: number): Entry[] {
  return [
    ...budgetAlerts(state, t).map((a) => ({
      kind: "alert" as const,
      key: `alert/${a.hostId}/${a.label}`,
      label: a.label,
      ...(a.clientId ? { clientId: a.clientId } : {}),
    })),
    ...state.loopAlerts.map((alert) => ({
      kind: "loop" as const,
      key: `loop/${alert.hostId}/${loopPairKey(alert)}`,
      alert,
    })),
    ...watchAlerts(state).map((alert) => ({
      kind: "watch" as const,
      key: `watch/${alert.hostId}/${alert.cardId}`,
      alert,
    })),
    ...needsYou(state, t).map((item) => ({
      kind: "request" as const,
      key: `${item.hostId}/${item.requestId}`,
      item,
    })),
    // Issue #1478: a running session that says nothing waits for the person too, after the requests.
    ...quietAlerts(state, nowMs, t).map((alert) => ({
      kind: "quiet" as const,
      key: `quiet/${alert.key}`,
      alert,
    })),
    // What finished since the person last looked comes after what waits for them.
    ...sinceLastLook(state.finished, state.finishedLook).map((finish) => ({
      kind: "finished" as const,
      key: `finished/${finish.key}`,
      finish,
    })),
  ];
}

/** The requests waiting for the user: the list on the left, the chosen request's card on the right. */
export function NeedsYou(
  props: Readonly<{
    store: AppStore;
    state: AppState;
    go(route: Route): void;
    onOpenRequest(item: PendingItem): void;
  }>,
) {
  const { store, state, go } = props;
  const { t } = store.i18n;
  const entries = entriesOf(state, t, store.now());
  const waiting = entries.filter((e) => e.kind !== "finished");
  const firstFinished = entries.findIndex((e) => e.kind === "finished");
  const [selected, setSelected] = useState<string | null>(null);
  /** The row the keyboard is on (-1: none yet). */
  const [cursor, setCursor] = useState(-1);
  const scope = store.clientScope.get();
  const projectOf = sessionProjectKeys(hubRows(state));
  const chipOf = (sessionId: string) => {
    const key = projectOf.get(sessionId);
    return key === undefined ? null : scope.chipOf(key);
  };
  // Leaving the page is the look: what finished while it was open is not new the next time.
  const shownFinished = useRef(0);
  shownFinished.current = entries.length - waiting.length;
  useEffect(
    () => () => {
      if (shownFinished.current > 0) store.finished.seen();
    },
    [store],
  );
  const chosen = entries.find((e) => e.key === selected);
  // One handler for every row, reading the list as it is now: a row's memo holds across renders.
  const latest = useRef({ entries, open: (_entry: Entry) => {} });
  const activate = useCallback((i: number) => {
    const entry = latest.current.entries[i];
    if (!entry) return;
    setCursor(i);
    latest.current.open(entry);
  }, []);
  const minute = Math.floor(store.now() / 60_000);
  const away = awayView(state.away, state.hosts);
  // Dismissing removes the button that had the focus: it goes to the first row, or the heading.
  const listRef = useRef<HTMLUListElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const dismissedHere = useRef(false);
  const dismissAway = () => {
    dismissedHere.current = true;
    store.activity.dismissAway();
  };
  useEffect(() => {
    if (away || !dismissedHere.current) return;
    dismissedHere.current = false;
    (listRef.current?.querySelector<HTMLElement>("button") ?? titleRef.current)?.focus();
  });
  // Acting on a quiet session can remove the button that had the focus (snooze, or the host clearing the mark): it goes to the first row or the heading.
  const quietActed = useRef(false);
  useEffect(() => {
    if (!quietActed.current || chosen?.kind === "quiet") return;
    quietActed.current = false;
    (listRef.current?.querySelector<HTMLElement>("button") ?? titleRef.current)?.focus();
  });
  const open = (entry: Entry) => {
    if (entry.kind === "alert")
      go(entry.clientId ? { name: "clients" } : { name: "settings", section: "budgets" });
    else setSelected(entry.key);
  };
  latest.current = { entries, open };

  // J and K move the cursor, Enter opens the row under it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || inSummary(e.target)) return;
      if (e.key === "j") setCursor(Math.min(entries.length - 1, cursor + 1));
      else if (e.key === "k") setCursor(Math.max(0, cursor - 1));
      else if (e.key === "Enter" && entries[cursor]) open(entries[cursor] as Entry);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Issue #187 (J4): once the chosen request is answered, the one now in its place is chosen, so
  // a run of requests is answered key after key. A chosen alert that goes leaves nothing chosen.
  const requests = entries.filter((e) => e.kind === "request");
  const lastAt = useRef(-1);
  if (chosen) lastAt.current = requests.findIndex((e) => e.key === selected);
  useEffect(() => {
    if (selected === null || chosen) return;
    const next =
      lastAt.current < 0 ? undefined : requests[Math.min(lastAt.current, requests.length - 1)];
    lastAt.current = -1;
    setSelected(next?.key ?? null);
  });
  // The chosen request's card takes the focus: A and N answer it with no click first.
  const detailBox = useRef<HTMLDivElement>(null);
  const chosenRequest = chosen?.kind === "request" ? chosen.item.requestId : null;
  useEffect(() => {
    if (!chosenRequest) return;
    detailBox.current
      ?.querySelector<HTMLElement>("[data-slot='approval-card']")
      ?.focus({ preventScroll: true });
  }, [chosenRequest]);

  if (entries.length === 0) {
    return (
      <section className="flex h-full flex-col gap-4 p-6">
        <h1
          ref={titleRef}
          tabIndex={-1}
          className="rounded-sm font-semibold text-xl focus-visible:outline-2 focus-visible:outline-ring"
        >
          {t("needsYou.title")}
        </h1>
        {away && <WhileAway store={store} view={away} go={go} onDismiss={dismissAway} />}
        <EmptyState
          icon={CheckCheck}
          title={t("needsYou.empty")}
          action={
            <Button variant="outline" onClick={() => go({ name: "hub" })}>
              {t("needsYou.seeSessions")}
            </Button>
          }
        />
      </section>
    );
  }

  const list = (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex items-baseline gap-2 border-b px-4 py-3">
        <h1
          ref={titleRef}
          tabIndex={-1}
          className="rounded-sm font-semibold text-base focus-visible:outline-2 focus-visible:outline-ring"
        >
          {t("needsYou.title")}
        </h1>
        <span className="text-muted-foreground text-xs tabular-nums">{waiting.length}</span>
      </div>
      {away && <WhileAway store={store} view={away} go={go} onDismiss={dismissAway} />}
      <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        {waiting.length === 0 && (
          <li>
            <p className={NOTE}>{t("needsYou.empty")}</p>
          </li>
        )}
        {entries.map((entry, i) => (
          <Fragment key={entry.key}>
            {i === firstFinished && (
              <li>
                <h2 className={HEADING}>{t("needsYou.finished")}</h2>
              </li>
            )}
            <EntryRow
              entry={entry}
              index={i}
              active={cursor === i}
              selected={selected === entry.key}
              store={store}
              chip={entry.kind === "request" ? chipOf(entry.item.sessionId) : null}
              minute={minute}
              lang={t.lang}
              hostName={entry.kind === "finished" ? hostNameOf(store, entry.finish.hostId) : ""}
              onActivate={activate}
            />
          </Fragment>
        ))}
      </ul>
    </section>
  );

  // A budget alert has no right-hand side: nothing is shown, the empty hint stays.
  const detail =
    chosen && chosen.kind !== "alert" ? (
      <Detail
        chosen={chosen}
        requests={requests.length}
        detailBox={detailBox}
        store={store}
        go={go}
        onOpenRequest={props.onOpenRequest}
        onQuietActed={() => {
          quietActed.current = true;
        }}
      />
    ) : null;

  return (
    <SplitView
      list={list}
      detail={detail}
      empty={
        <div className="flex h-full items-center justify-center p-6">
          <EmptyState icon={MousePointerClick} title={t("needsYou.choose")} />
        </div>
      }
      onClose={() => setSelected(null)}
      labels={{ resize: t("needsYou.resize"), back: t("needsYou.back") }}
      initialWidth={store.viewPrefs.listWidth()}
      onResize={(width) => store.viewPrefs.setListWidth(width)}
    />
  );
}
