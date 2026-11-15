import type { BoardColumn, Card, ContractOverrides } from "@flightdeck/protocol";
import {
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useEffect,
  useState,
} from "react";
import { BulkDiscardDialog, discardCommand } from "@/features/board/bulk-discard-dialog";
import { cardMoveBody, dropPositions, stayingPicks } from "@/features/board/domain/board-derive";
import type { AppStore } from "../../lib/app-store.ts";
import {
  type BulkSplit,
  refusalNotice,
  requestResult,
  runMany,
  updateMany,
  updateSummary,
} from "./domain/board-bulk.ts";
import { askAbout, type Lacking } from "./domain/board-contracts.ts";
import { type BulkRefusal, moveMany } from "./domain/board-select.ts";

/** A move waiting on the person's answer: the cards lack something its column asks (issue #78). */
export type MoveAsk = {
  column: BoardColumn;
  targetId?: string;
  cards: Card[];
  lacking: Lacking[];
};

/**
 * What the board does with its selection: move it, discard it (behind a confirm) and update it
 * from the base. The board keeps the selection, the busy flag, the notice and the question of a
 * move, and lends them here; `dialog` is the discard confirm the board renders.
 */
export function useSelectionActions(options: {
  store: AppStore;
  hostId: string;
  /** The cards the selection acts on, their ids, and what Update takes from them. */
  acting: string[];
  actingCards: Card[];
  split: BulkSplit;
  contracts: ContractOverrides;
  columnOf(column: BoardColumn): Card[];
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setAsk: Dispatch<SetStateAction<MoveAsk | null>>;
  setPicked: Dispatch<SetStateAction<string[]>>;
  setNotice: Dispatch<SetStateAction<string | null>>;
  nameRefusals(refused: BulkRefusal[]): string;
  /** What had the focus when a confirm opened, and where it goes when it closes (#1426). */
  opener: { remember(): void; restore(): void };
  boardRef: RefObject<HTMLDivElement | null>;
}): {
  moveSelected(
    column: BoardColumn,
    targetId?: string,
    only?: Card[],
    force?: boolean,
  ): Promise<void>;
  askDiscard(): void;
  updateSelected(): Promise<void>;
  updating: { done: number; total: number } | null;
  dialog: ReactNode;
} {
  const {
    store,
    hostId,
    acting,
    actingCards,
    split,
    contracts,
    columnOf,
    busy,
    setBusy,
    setAsk,
    setPicked,
    setNotice,
    nameRefusals,
    opener,
    boardRef,
  } = options;
  const { t } = store.i18n;
  const [discardingMany, setDiscardingMany] = useState(false);
  /** Moves the shown selected cards, quietly; the host's refusals are named afterwards. */
  const moveSelected = async (
    column: BoardColumn,
    targetId?: string,
    only?: Card[],
    force = false,
  ) => {
    if (busy) return;
    // One question for the whole group; a group already asked about (`only`) goes straight on.
    if (!only) {
      const lacking = askAbout(column, actingCards, contracts);
      if (lacking.length > 0) {
        setAsk({ column, targetId, cards: actingCards, lacking });
        return;
      }
    }
    const cards = only ?? actingCards;
    const ids = new Set(cards.map((card) => card.id));
    setBusy(true);
    // Dropped on a card, the group lands before it, in the board's order.
    const positions = dropPositions(columnOf(column), cards, targetId);
    const refused = await moveMany(
      cards,
      column,
      async (cardId, to, position) => {
        const answer = await store.hostRequest(
          hostId,
          "card.move",
          cardMoveBody(cardId, to, position, force),
        );
        return requestResult(answer);
      },
      positions,
    );
    const stayed = new Set(refused.map((r) => r.card.id));
    setPicked((before) => stayingPicks(before, ids, stayed));
    setNotice(
      refusalNotice(t, refused, nameRefusals(refused), {
        one: "board.stayedOne",
        many: "board.stayed",
      }),
    );
    setBusy(false);
    boardRef.current?.focus();
  };
  /** Discards the started cards and deletes the others, one after the other. */
  const discardSelected = async () => {
    if (busy) return;
    const cards = actingCards;
    setDiscardingMany(false);
    setBusy(true);
    const failed = await runMany(cards, async (card) =>
      requestResult(
        await store.hostRequest(hostId, discardCommand(card), { cardId: card.id, confirm: true }),
      ),
    );
    // A discard is not atomic on the host: a card it refused may be partly cleaned up, so it is
    // not left selected for a second try that would fail on what is already gone.
    setPicked((before) => before.filter((id) => !acting.includes(id)));
    setNotice(
      refusalNotice(t, failed, nameRefusals(failed), {
        one: "board.discardFailedOne",
        many: "board.discardFailed",
      }),
    );
    setBusy(false);
    boardRef.current?.focus();
  };
  /** #1406: runs of Update from the base that finished; each puts the focus back after its render. */
  const [updated, setUpdated] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a finished run is the only trigger
  useEffect(() => {
    if (updated > 0) opener.restore();
  }, [updated]);
  /** #1406: the run of Update from the base, card by card: how far it got. */
  const [updating, setUpdating] = useState<{ done: number; total: number } | null>(null);
  /**
   * #1406: updates the selection's idle cards with a branch from their base, one at a time. A card
   * already on its base is not rebased; a conflicted or refused one stays selected, named.
   */
  const updateSelected = async () => {
    if (busy || split.update.length === 0) return;
    const cards = split.update;
    opener.remember();
    setBusy(true);
    setNotice(null);
    setUpdating({ done: 0, total: cards.length });
    const results = await updateMany(cards, {
      behind: async (card) => {
        const answer = await store.hostRequest(hostId, "changes.get", {
          target: `card:${card.id}`,
        });
        return answer.ok ? (answer.data.position?.behind ?? null) : null;
      },
      update: async (card) => {
        const answer = await store.hostRequest(hostId, "card.updateFromBase", {
          cardId: card.id,
        });
        return requestResult(answer);
      },
      onProgress: (done, total) => setUpdating({ done, total }),
    });
    const went = new Set(
      results
        .filter((r) => r.outcome === "updated" || r.outcome === "current")
        .map((r) => r.card.id),
    );
    setPicked((before) => before.filter((id) => !went.has(id)));
    setNotice(updateSummary(t, results));
    setUpdating(null);
    setBusy(false);
    // The button was disabled while it ran, and a browser takes the focus off a disabled button:
    // it goes back once the render has turned the button on again.
    setUpdated((n) => n + 1);
  };
  const askDiscard = () => {
    opener.remember();
    setDiscardingMany(true);
  };
  const dialog = discardingMany && (
    <BulkDiscardDialog
      cards={actingCards}
      t={t}
      onCancel={() => setDiscardingMany(false)}
      onConfirm={() => void discardSelected()}
      onRestoreFocus={opener.restore}
    />
  );
  return { moveSelected, askDiscard, updateSelected, updating, dialog };
}
