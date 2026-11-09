import type { Budget, Card } from "@flightdeck/protocol";
import type { T } from "../i18n/index.ts";
import { answerOf, type BulkRefusal } from "./board-select.ts";
import { cardStartBlock } from "./card-start-block.ts";

/** Start N and Stop N of the selection (#1354): what each can take, and why the rest stay out. */
export interface BulkSplit {
  start: Card[];
  /** The cards Start leaves out, each with its reason ("already running"). */
  skipStart: Array<{ card: Card; reason: string }>;
  stop: Card[];
  skipStop: Card[];
}

/** Start takes the cards neither running nor queued; Stop takes the ones that are (`stopCard`). */
export function bulkSplit(cards: Card[], t: T): BulkSplit {
  const split: BulkSplit = { start: [], skipStart: [], stop: [], skipStop: [] };
  for (const card of cards) {
    const block = cardStartBlock(card);
    if (block === null) {
      split.start.push(card);
      split.skipStop.push(card);
    } else {
      split.skipStart.push({
        card,
        reason: t(block === "queued" ? "board.startQueued" : "board.startRunning"),
      });
      split.stop.push(card);
    }
  }
  return split;
}

/** How many of `count` cards start now and how many wait, with `max` at once and `running` going. */
export function queueSplit(
  count: number,
  max: number,
  running: number,
): { now: number; later: number } {
  const now = Math.min(count, Math.max(0, max - running));
  return { now, later: count - now };
}

/** The Start confirm's line about the queue; `max` null when the host did not say it. */
export function queueLine(t: T, split: { now: number; later: number }, max: number | null): string {
  if (split.later === 0) return t("board.startAllNow");
  if (max === null || split.now === 0) return t("board.startQueue");
  const started = split.now === 1 ? t("board.startNowOne") : t("board.startNow", { n: split.now });
  const waiting = split.later === 1 ? t("board.waitOne") : t("board.wait", { n: split.later });
  return t("board.startSplit", { started, waiting, max });
}

/** What asks the host to start or stop one card, without a toast of its own. */
export type CardRequest = (
  card: Card,
) => Promise<
  | { ok: true }
  | { ok: false; message: string; reason?: string; params?: Record<string, string | number> }
>;

/** Runs `request` for each card, one after the other; the refused ones come back named. */
export async function runMany(cards: Card[], request: CardRequest): Promise<BulkRefusal[]> {
  const refused: BulkRefusal[] = [];
  for (const card of cards) {
    const answer = await request(card); // NOSONAR: one card at a time, so the host's queue sees them in the board's order
    if (!answer.ok) refused.push({ card, ...answerOf(answer) });
  }
  return refused;
}

/**
 * The Start confirm's lines about what keeps new cards waiting on the host (#1393): a budget that
 * holds new cards and is at its limit, and the host's own memory hold, which only a queued card's
 * reason reports. A hold the host does not report adds no line.
 */
export function holdLines(
  t: T,
  host: string,
  input: { budgets: Budget[]; projectKey: string | null; cards: Card[] },
): string[] {
  const reported = (reason: Card["queueReason"]) =>
    input.cards.some((card) => card.queued && card.queueReason === reason);
  const overBudget = input.budgets.some(
    (budget) =>
      budget.action === "queue" &&
      budget.fraction >= 1 &&
      (budget.scope === "host" ||
        (budget.projectKey !== null && budget.projectKey === input.projectKey)),
  );
  const lines: string[] = [];
  if (overBudget || reported("budget")) lines.push(t("board.startBudgetHold", { host }));
  if (reported("memory")) lines.push(t("board.startMemoryHold", { host }));
  return lines;
}
