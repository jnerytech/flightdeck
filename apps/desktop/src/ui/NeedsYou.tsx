import { CheckCheck, MousePointerClick } from "lucide-react";
import { Fragment, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { ApprovalCard } from "@/components/approval/approval-card";
import { GateText } from "@/components/approval/gate-text";
import { ClientChip } from "@/components/clients/client-chip";
import { ActionButton } from "@/components/feedback/action-button";
import { SplitView } from "@/components/layout/split-view";
import { Inline, Stack } from "@/components/layout/stack";
import { EmptyState } from "@/components/layout/states";
import { StatusDot } from "@/components/status/status-dot";
import { Button } from "@/components/ui/button";
import { formatAgo } from "../i18n/format.ts";
import type { Key, T } from "../i18n/index.ts";
import {
  type AppState,
  type AppStore,
  type LoopAlert,
  loopPairKey,
  needsYou,
  type PendingItem,
} from "../lib/app-store.ts";
import { budgetAlerts } from "../lib/budgets.ts";
import { sessionProjectKeys } from "../lib/client-scope.ts";
import type { ClientColor } from "../lib/clients.ts";
import { type Finish, sinceLastLook } from "../lib/finished.ts";
import { hubRows } from "../lib/hub.ts";
import { typing } from "../lib/keys.ts";
import { pendingText } from "../lib/pending-text.ts";
import type { Route } from "../lib/router.ts";
import { type WatchAlert, watchAlerts } from "../lib/watch-alerts.ts";

/** A line of the list: a budget alert (opens Settings), a paused loop or a request (shows its card). */
type Entry =
  | { kind: "alert"; key: string; label: string; clientId?: string }
  | { kind: "loop"; key: string; alert: LoopAlert }
  | { kind: "watch"; key: string; alert: WatchAlert }
  | { kind: "request"; key: string; item: PendingItem }
  | { kind: "finished"; key: string; finish: Finish };

// items-stretch: a button's own style is align-items: flex-start, which leaves a line no width
// to cut at (issue #175).
const ROW_PAD = "px-2 py-1.5";
const ROW = `flex w-full min-w-0 flex-col items-stretch gap-0.5 rounded-md ${ROW_PAD} text-left transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:bg-accent aria-pressed:bg-accent`;

/** The first line of a row: a dot, then the text. A span, since a row is a button. */
function RowHead(props: Readonly<{ children: ReactNode }>) {
  return <span className="flex items-center gap-2">{props.children}</span>;
}

/** The right-hand side for something that is not a request: a column that scrolls by itself. */
function DetailColumn(props: Readonly<{ children: ReactNode }>) {
  return <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">{props.children}</div>;
}

/** Everything that waits for the person, in the list's order: budget alerts, loops, watches, requests. */
function entriesOf(state: AppState, t: T): Entry[] {
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
    // What finished since the person last looked comes after what waits for them.
    ...sinceLastLook(state.finished, state.finishedLook).map((finish) => ({
      kind: "finished" as const,
      key: `finished/${finish.key}`,
      finish,
    })),
  ];
}

/** A row of the list: a button in a list item, whatever the kind of line it holds. */
function RowButton(
  props: Readonly<{
    active: boolean;
    pressed?: boolean;
    label?: string;
    onActivate(): void;
    children: ReactNode;
  }>,
) {
  return (
    <li>
      <button
        type="button"
        {...(props.label ? { "aria-label": props.label } : {})}
        {...(props.pressed === undefined ? {} : { "aria-pressed": props.pressed })}
        data-active={props.active}
        className={ROW}
        onClick={props.onActivate}
      >
        {props.children}
      </button>
    </li>
  );
}

/** The first line of a row of a request, a loop or a watch: the dot, then its text. */
function DotLine(props: Readonly<{ t: T; text: string; children?: ReactNode }>) {
  return (
    <RowHead>
      <StatusDot tone="needs-you" label={props.t("hub.stateDots.needs_you")} />
      <span className="min-w-0 flex-1 truncate text-sm">{props.text}</span>
      {props.children}
    </RowHead>
  );
}

/** A line of the list, by the kind of entry it is. */
function EntryRow(
  props: Readonly<{
    entry: Entry;
    active: boolean;
    selected: boolean;
    store: AppStore;
    chipOf(sessionId: string): { name: string; color: ClientColor } | null;
    onActivate(): void;
  }>,
) {
  const { entry, active, selected, store, onActivate } = props;
  const { t } = store.i18n;
  if (entry.kind === "alert") {
    return (
      <RowButton active={active} onActivate={onActivate}>
        <span className="truncate text-sm">{entry.label}</span>
      </RowButton>
    );
  }
  if (entry.kind === "watch") {
    const label = t("watchUi.entry", {
      card: entry.alert.title,
      reason: entry.alert.watch.reason ?? "",
    });
    return (
      <RowButton active={active} pressed={selected} label={label} onActivate={onActivate}>
        <DotLine t={t} text={label} />
      </RowButton>
    );
  }
  if (entry.kind === "loop") {
    const text = t("needsYou.loopRow", { from: entry.alert.from, to: entry.alert.to });
    return (
      <RowButton active={active} pressed={selected} onActivate={onActivate}>
        <DotLine t={t} text={text} />
      </RowButton>
    );
  }
  if (entry.kind === "finished") {
    const { finish } = entry;
    const outcome = t(`needsYou.finishedOutcome.${finish.outcome}` as Key);
    const who = `${hostNameOf(store, finish.hostId)} · ${finish.name}`;
    return (
      <RowButton
        active={active}
        pressed={selected}
        label={`${who}: ${outcome}`}
        onActivate={onActivate}
      >
        <RowHead>
          <StatusDot tone={FINISH_TONE[finish.outcome]} label={outcome} />
          <span className="min-w-0 flex-1 truncate text-sm">{who}</span>
          <span className="shrink-0 text-muted-foreground text-xs">{outcome}</span>
          <time
            dateTime={finish.at}
            className="shrink-0 text-muted-foreground text-xs tabular-nums"
          >
            {formatAgo(store.now() - Date.parse(finish.at), t)}
          </time>
        </RowHead>
      </RowButton>
    );
  }
  const { item } = entry;
  const chip = props.chipOf(item.sessionId);
  // A workflow gate is not a tool: its line says which step waits (issue #175).
  const what = pendingText(item, t);
  const who = `${item.hostName} · ${item.sessionName}`;
  return (
    <RowButton active={active} pressed={selected} label={`${who}: ${what}`} onActivate={onActivate}>
      <DotLine t={t} text={who}>
        {chip && <ClientChip name={chip.name} color={chip.color} />}
        <time
          dateTime={item.createdAt}
          className="shrink-0 text-muted-foreground text-xs tabular-nums"
        >
          {formatAgo(store.now() - Date.parse(item.createdAt), t)}
        </time>
      </DotLine>
      <span className="truncate pl-5 text-muted-foreground text-xs" title={what}>
        {what}
      </span>
    </RowButton>
  );
}

const FINISH_TONE = { done: "idle", failed: "error", ended: "ended" } as const;

/** The name of a host, as the list shows it; its id when it is gone. */
function hostNameOf(store: AppStore, hostId: string): string {
  return store.getState().hosts.find((h) => h.id === hostId)?.name ?? hostId;
}

/** A session that finished: how, when, how many files it changed, and the way to its Changes. */
function FinishedDetail(
  props: Readonly<{ finish: Finish; store: AppStore; go(route: Route): void }>,
) {
  const { finish, store, go } = props;
  const { t } = store.i18n;
  const outcome = t(`needsYou.finishedOutcome.${finish.outcome}` as Key);
  const files =
    finish.files === null
      ? null
      : finish.files === 0
        ? t("needsYou.finishedNoFiles")
        : finish.files === 1
          ? t("needsYou.finishedFilesOne")
          : t("needsYou.finishedFilesMany", { n: finish.files });
  return (
    <DetailColumn>
      <h2 className="font-semibold text-base">{finish.name}</h2>
      <p className="text-sm">
        {hostNameOf(store, finish.hostId)} · {outcome} ·{" "}
        {formatAgo(store.now() - Date.parse(finish.at), t)}
      </p>
      {files && <p className="text-sm">{files}</p>}
      <Inline gap={2}>
        <Button
          onClick={() => {
            store.sessionViews.remember(finish.key, "changes");
            go({ name: "session", host: finish.hostId, id: finish.sessionId });
          }}
        >
          {t("needsYou.seeChanges")}
        </Button>
      </Inline>
    </DetailColumn>
  );
}

/** A card whose watch needs the person: why, the rounds so far, and the ways on. */
function WatchDetail(
  props: Readonly<{ alert: WatchAlert; store: AppStore; go(route: Route): void }>,
) {
  const { alert, store, go } = props;
  const { t } = store.i18n;
  return (
    <DetailColumn>
      <h2 className="font-semibold text-base">{t("watchUi.notifyTitle")}</h2>
      <p className="text-sm">{alert.title}</p>
      <p className="text-sm">{t("watchUi.needsYou", { reason: alert.watch.reason ?? "" })}</p>
      <Stack as="ul" gap={1} className="text-sm">
        {alert.watch.rounds.map((round) => (
          <li key={round.id}>
            {t("watchUi.round", { n: round.n, status: t(`watchUi.status.${round.status}` as Key) })}
            {round.summary ? ` — ${round.summary}` : ""}
          </li>
        ))}
      </Stack>
      <Inline gap={2}>
        <ActionButton onClick={() => store.setWatch(alert.hostId, alert.cardId, true)}>
          {t("watchUi.resume")}
        </ActionButton>
        {alert.projectId && (
          <Button
            variant="outline"
            onClick={() =>
              go({
                name: "card",
                host: alert.hostId,
                projectId: alert.projectId as string,
                cardId: alert.cardId,
              })
            }
          >
            {t("watchUi.openCard")}
          </Button>
        )}
      </Inline>
    </DetailColumn>
  );
}

/** Two sessions that keep answering each other: the message, and the way to let them go on. */
function LoopDetail(props: Readonly<{ alert: LoopAlert; store: AppStore }>) {
  const { alert, store } = props;
  const { t } = store.i18n;
  return (
    <DetailColumn>
      <h2 className="font-semibold text-base">{t("needsYou.loopTitle")}</h2>
      <p className="text-sm">{alert.message}</p>
      <div>
        <Button onClick={() => void store.releasePair(alert.hostId, loopPairKey(alert))}>
          {t("needsYou.release")}
        </Button>
      </div>
    </DetailColumn>
  );
}

/** The ways to act on a request besides answering it: its secret rule, or open its session. */
function RequestActions(
  props: Readonly<{
    item: PendingItem;
    store: AppStore;
    go(route: Route): void;
    onOpenRequest(item: PendingItem): void;
  }>,
) {
  const { item, store, go } = props;
  const { t } = store.i18n;
  // A request for a secret belongs to no session: the card is all there is to open.
  if (item.vault) {
    return (
      <>
        {item.vaultOnce && (
          <ActionButton
            variant="outline"
            onClick={() => store.approveVaultForSession(item.hostId, item.requestId)}
          >
            {t("vaultRulesUi.approveSession")}
          </ActionButton>
        )}
        <Button
          variant="ghost"
          onClick={() => item.vaultRule && go({ name: "vault", rule: item.vaultRule })}
        >
          {t("vaultRulesUi.fromRequest")}
        </Button>
      </>
    );
  }
  return (
    <Button variant="ghost" onClick={() => props.onOpenRequest(item)}>
      {t(item.gate ? "approval.openCard" : "approval.openSession")}
    </Button>
  );
}

/** The chosen request: how many are left, and its approval card. */
function RequestDetail(
  props: Readonly<{
    item: PendingItem;
    left: number;
    detailBox: RefObject<HTMLDivElement | null>;
    store: AppStore;
    go(route: Route): void;
    onOpenRequest(item: PendingItem): void;
  }>,
) {
  const { item, store, go } = props;
  const { t } = store.i18n;
  return (
    <div ref={props.detailBox} className="h-full overflow-y-auto p-4">
      <Stack gap={2}>
        <p className="text-muted-foreground text-xs">
          {props.left === 1 ? t("needsYou.leftOne") : t("needsYou.leftMany", { n: props.left })}
        </p>
        <ApprovalCard
          key={item.requestId}
          request={{
            requestId: item.requestId,
            toolName: item.gate
              ? t("needsYou.gateTool", { step: item.gate.stepId })
              : item.toolName,
            input: item.input ?? {},
            cwd: item.cwd ?? null,
            createdAt: item.createdAt,
            ...(item.risk ? { risk: item.risk } : {}),
            ...(item.riskReason ? { riskReason: item.riskReason } : {}),
          }}
          t={t}
          nowMs={store.now()}
          onCopyPath={(text) => void store.copyText(text)}
          {...(item.gateText ? { body: <GateText {...item.gateText} /> } : {})}
          onRespond={(decision, message, _updates, updatedInput, held) => {
            if (item.gate) {
              const verdict = decision === "allow" ? "approve" : "reject";
              return store.respondGate(item.hostId, item.gate, verdict, message);
            }
            return store.respondTo(item.hostId, item.requestId, decision, {
              message,
              updatedInput,
              held,
            });
          }}
          actions={
            <RequestActions item={item} store={store} go={go} onOpenRequest={props.onOpenRequest} />
          }
        />
      </Stack>
    </div>
  );
}

/** The right-hand side for the chosen line, by its kind (a budget alert has none). */
function Detail(
  props: Readonly<{
    chosen: Exclude<Entry, { kind: "alert" }>;
    requests: number;
    detailBox: RefObject<HTMLDivElement | null>;
    store: AppStore;
    go(route: Route): void;
    onOpenRequest(item: PendingItem): void;
  }>,
) {
  const { chosen, store, go } = props;
  if (chosen.kind === "watch") return <WatchDetail alert={chosen.alert} store={store} go={go} />;
  if (chosen.kind === "loop") return <LoopDetail alert={chosen.alert} store={store} />;
  if (chosen.kind === "finished")
    return <FinishedDetail finish={chosen.finish} store={store} go={go} />;
  return (
    <RequestDetail
      item={chosen.item}
      left={props.requests}
      detailBox={props.detailBox}
      store={store}
      go={go}
      onOpenRequest={props.onOpenRequest}
    />
  );
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
  const entries = entriesOf(state, t);
  const waiting = entries.filter((e) => e.kind !== "finished");
  const firstFinished = entries.findIndex((e) => e.kind === "finished");
  const [selected, setSelected] = useState<string | null>(null);
  /** The row the keyboard is on (-1: none yet). */
  const [cursor, setCursor] = useState(-1);
  const scope = store.clientScope();
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
      if (shownFinished.current > 0) store.finishedSeen();
    },
    [store],
  );
  const chosen = entries.find((e) => e.key === selected);
  const open = (entry: Entry) => {
    if (entry.kind === "alert")
      go(entry.clientId ? { name: "clients" } : { name: "settings", section: "budgets" });
    else setSelected(entry.key);
  };

  // J and K move the cursor, Enter opens the row under it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
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
        <h1 className="font-semibold text-xl">{t("needsYou.title")}</h1>
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
        <h1 className="font-semibold text-base">{t("needsYou.title")}</h1>
        <span className="text-muted-foreground text-xs tabular-nums">{waiting.length}</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {entries.map((entry, i) => (
          <Fragment key={entry.key}>
            {i === firstFinished && (
              <li>
                <h2 className={`${ROW_PAD} font-medium text-muted-foreground text-xs`}>
                  {t("needsYou.finished")}
                </h2>
              </li>
            )}
            <EntryRow
              entry={entry}
              active={cursor === i}
              selected={selected === entry.key}
              store={store}
              chipOf={chipOf}
              onActivate={() => {
                setCursor(i);
                open(entry);
              }}
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
      initialWidth={store.listWidth()}
      onResize={(width) => store.setListWidth(width)}
    />
  );
}
