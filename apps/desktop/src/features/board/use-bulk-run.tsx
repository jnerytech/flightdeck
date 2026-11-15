import type { Card, ContractOverrides, Project } from "@flightdeck/protocol";
import {
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useRef,
  useState,
} from "react";
import { useSuggestedPersona } from "@/features/personas/ui.ts";
import { elsewhereNotice, useStartElsewhere, waitingCards } from "@/features/sessions/index.ts";
import { useStoreSlice } from "@/lib/use-store";
import type { AppStore } from "../../lib/app-store.ts";
import { BulkRunDialog } from "./bulk-run-dialog.tsx";
import {
  type BulkSplit,
  bulkRunOutcome,
  bulkSkipReason,
  bulkTitle,
  holdLines,
  requestResult,
  runMany,
  startConfirmLines,
  startQuotaLines,
} from "./domain/board-bulk.ts";
import { queueMaxOf, startableWorkflows } from "./domain/board-derive.ts";
import type { BulkRefusal } from "./domain/board-select.ts";
import { cardStartBlock } from "./domain/card-start-block.ts";
import { startPersonaOf, startWorkflowOf } from "./domain/card-template.ts";

const BULKRUN_KEYS = ["cards", "personas", "quota", "account", "budgets", "hosts"] as const;

/**
 * #1354: Start N and Stop N on the board's selection. `askStart` and `askStop` open the confirm,
 * `dialog` is what the board renders, and what the confirm needs (the host's queue limit, the
 * project's workflows, the memory hold) is asked each time it opens: a reply to an earlier open is
 * dropped. The board keeps the selection, the busy flag and the notice, and lends them here.
 */
export function useBulkRun(options: {
  store: AppStore;
  hostId: string;
  projectId: string;
  project: Project | null;
  /** The project's cards, and the ones the selection acts on, split into what Start, Stop and Update take. */
  all: Card[];
  actingCards: Card[];
  split: BulkSplit;
  contracts: ContractOverrides;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setPicked: Dispatch<SetStateAction<string[]>>;
  setNotice: Dispatch<SetStateAction<string | null>>;
  /** The host announces its memory hold (#1414). */
  memoryPause: boolean;
  nameRefusals(refused: BulkRefusal[]): string;
  /** What had the focus when the confirm opened, and where it goes when it closes (#1426). */
  opener: { remember(): void; restore(): void };
  boardRef: RefObject<HTMLDivElement | null>;
}): { askStart(): void; askStop(): void; dialog: ReactNode } {
  const {
    store,
    hostId,
    projectId,
    project,
    all,
    actingCards,
    split,
    contracts,
    busy,
    setBusy,
    setPicked,
    setNotice,
    memoryPause,
    nameRefusals,
    opener,
    boardRef,
  } = options;
  const state = useStoreSlice(store, BULKRUN_KEYS);
  const { t } = store.i18n;
  const suggestedPersona = useSuggestedPersona(store, hostId, "dev");
  /** #1422: the other hosts a Start that would wait can go to. */
  const elsewhere = useStartElsewhere({
    store,
    hostId,
    sourceKey: project ? store.projectList.keyOf(hostId, project) : null,
    hosts: state.hosts,
    cards: state.cards,
    t,
  });
  /** #1354: the Start N or Stop N confirm, and the host's limit of runs at once (null: not known). */
  const [bulk, setBulk] = useState<"start" | "stop" | null>(null);
  const [queueMax, setQueueMax] = useState<number | null | undefined>(undefined);
  /** The project's workflows (their inputs), asked when Start N's confirm opens; null until then. */
  const [workflows, setWorkflows] = useState<Array<{ name: string; inputs: string[] }> | null>(
    null,
  );
  const [workflowsFailed, setWorkflowsFailed] = useState(false);
  /** #1414: the host's memory was at or over its hold when the confirm opened. */
  const [memoryOver, setMemoryOver] = useState(false);
  /** Which open of Start N's confirm the host's replies belong to. */
  const startAsked = useRef(0);
  /** Opens Start N's confirm, and asks the host its limit and the project's workflows for it. */
  const askStart = () => {
    if (busy || split.start.length === 0) return;
    opener.remember();
    // Each open asks again; a reply to an earlier open is dropped (#1390's review).
    const asked = ++startAsked.current;
    setQueueMax(undefined);
    setWorkflows(null);
    setWorkflowsFailed(false);
    setMemoryOver(false);
    setBulk("start");
    elsewhere.load();
    // Start waits for both (the confirm's button is off): the queue line and each card's workflow.
    void store.hostCommand(hostId, "project.list", {}).then((list) => {
      if (asked !== startAsked.current) return;
      setQueueMax(queueMaxOf(list));
    });
    // The memory hold, read now: with nothing queued yet no card carries its reason (#1414). It
    // fails open: a host that does not answer gets no line, and Start does not wait for it.
    if (memoryPause) {
      // The host's own verdict (#1418's review): the share alone is wrong a margin under the hold,
      // and on a host with no reading (macOS). An older host that does not say gets no line.
      void store
        .hostRequest(hostId, "resources.get", {})
        .then((answer) => {
          if (asked !== startAsked.current || !answer.ok) return;
          setMemoryOver(answer.data.memoryHolding === true);
        })
        .catch(() => {});
    }
    void store.hostCommand(hostId, "workflow.list", { projectId }).then((result) => {
      if (asked !== startAsked.current) return;
      // A read that failed is not an empty list: Start stays off and the confirm says why.
      if (!result) {
        setWorkflowsFailed(true);
        return;
      }
      // As the start dialog does: only a trusted workflow with no errors goes with a card.
      setWorkflows(startableWorkflows(result.workflows));
    });
  };
  const askStop = () => {
    if (busy || split.stop.length === 0) return;
    opener.remember();
    setBulk("stop");
  };
  /** A card whose workflow asks for inputs starts from its own dialog, where they are typed. */
  const workflowOf = (card: Card) =>
    startWorkflowOf(
      card,
      (workflows ?? []).map((w) => w.name),
    );
  const needsInputs = (card: Card) =>
    (workflows?.find((w) => w.name === workflowOf(card))?.inputs.length ?? 0) > 0;
  const startable = split.start.filter((card) => !needsInputs(card));
  const startReady = queueMax !== undefined && workflows !== null;
  /** The host's cards holding a run: the queue's places they take. */
  const runningOnHost = Object.entries(state.cards).filter(
    ([key, card]) => key.startsWith(`${hostId}/`) && cardStartBlock(card) === "running",
  ).length;
  /** Starts or stops the cards one at a time; the ones that went leave the selection. */
  const runSelected = async (kind: "start" | "stop") => {
    if (busy) return;
    const cards = kind === "start" ? startable : split.stop;
    setBulk(null);
    setBusy(true);
    const personaIds = (state.personas[hostId] ?? []).map((p) => p.id);
    const refused = await runMany(cards, async (card) => {
      const workflow = workflowOf(card);
      const persona = store.personas.ref(startPersonaOf(card, personaIds) ?? suggestedPersona);
      const answer =
        kind === "start"
          ? await store.hostRequest(hostId, "card.start", {
              cardId: card.id,
              ...(workflow ? { workflow, inputs: {} } : {}),
              ...(persona ? { persona } : {}),
            })
          : await store.hostRequest(hostId, "card.stop", { cardId: card.id });
      return requestResult(answer);
    });
    const stayed = new Set(refused.map((r) => r.card.id));
    const went = new Set(cards.map((card) => card.id).filter((id) => !stayed.has(id)));
    setPicked((before) => before.filter((id) => !went.has(id)));
    setNotice(bulkRunOutcome(t, kind, refused, nameRefusals(refused)));
    setBusy(false);
    boardRef.current?.focus();
  };
  const hostName = state.hosts.find((h) => h.id === hostId)?.name ?? hostId;
  /**
   * The host's quota lines, and every hold that keeps new cards waiting (the quota's pause limit, a
   * budget, the host's memory). A hold keeps every new card waiting, so the queue line then says they
   * all join the queue, never "N start now" (#1414).
   */
  const quota = startQuotaLines(t, hostName, {
    quota: state.quota[hostId],
    account: state.account[hostId],
    now: Date.now(),
    formatTime: (iso) => store.formatTime(iso),
  });
  const quotaLines = quota.lines;
  const holds = [...quota.holds];
  holds.push(
    ...holdLines(t, hostName, {
      budgets: state.budgets[hostId] ?? [],
      projectKey: project ? store.projectList.keyOf(hostId, project) : null,
      cards: all,
      memoryOver,
      // #1481: a paused host is a hold like the others: the confirm names it and the cards join the queue.
      paused: state.hosts.find((h) => h.id === hostId)?.hostInfo?.pause?.paused === true,
    }),
  );
  /** #1422: the startable cards that would wait here, and the hosts they could start on. */
  const waiting = waitingCards(startable, {
    held: holds.length > 0,
    max: queueMax ?? null,
    running: runningOnHost,
  });
  const otherHosts = bulk === "start" && startReady ? elsewhere.offers(waiting) : [];
  /** Hands the cards that would wait to another host: made and started there, then Done here. */
  const startOnOther = async (hostIdOther: string) => {
    const target = otherHosts.find((o) => o.hostId === hostIdOther);
    if (busy || !target) return;
    setBulk(null);
    setBusy(true);
    const outcome = await elsewhere.run(target, waiting);
    const went = new Set(outcome.moved.map((m) => m.card.id));
    setPicked((before) => before.filter((id) => !went.has(id)));
    setNotice(elsewhereNotice(t, outcome, target.name, nameRefusals));
    setBusy(false);
    boardRef.current?.focus();
  };
  /** The confirm's lines: the host's queue, quota and holds for Start, where the cards land for Stop. */
  const bulkLines = (): string[] =>
    bulk === "stop"
      ? [t("board.stopBody")]
      : startConfirmLines(t, {
          workflowsFailed,
          queueMax,
          startable,
          runningOnHost,
          quotaLines,
          holds,
          waitingElsewhere: otherHosts.length > 0 ? waiting.length : 0,
          contracts,
        });
  const dialog = bulk && (
    <BulkRunDialog
      t={t}
      title={bulkTitle(t, bulk, { start: startable.length, stop: split.stop.length })}
      lines={bulkLines()}
      items={actingCards.map((card) => {
        const skip = bulkSkipReason(t, bulk, split, card, needsInputs(card));
        return { id: card.id, title: card.title, ...(skip ? { skipped: skip } : {}) };
      })}
      confirmLabel={
        bulk === "start"
          ? t("board.startSelected", { n: startable.length })
          : t("board.stopSelected", { n: split.stop.length })
      }
      confirmDisabled={bulk === "start" && (!startReady || startable.length === 0)}
      alternatives={otherHosts.map((o) => ({
        id: o.hostId,
        label: t("board.startOn", { host: o.name }),
      }))}
      onAlternative={(id) => void startOnOther(id)}
      onCancel={() => setBulk(null)}
      onConfirm={() => void runSelected(bulk)}
      onRestoreFocus={opener.restore}
    />
  );
  return { askStart, askStop, dialog };
}
