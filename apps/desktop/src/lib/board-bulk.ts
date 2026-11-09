import type { Budget, Card } from "@flightdeck/protocol";
import type { T } from "../i18n/index.ts";
import { answerOf, type BulkRefusal } from "./board-select.ts";
import { cardStartBlock } from "./card-start-block.ts";
import { reasonText } from "./notice-text.ts";

/** Start N and Stop N of the selection (#1354): what each can take, and why the rest stay out. */
export interface BulkSplit {
  start: Card[];
  /** The cards Start leaves out, each with its reason ("already running"). */
  skipStart: Array<{ card: Card; reason: string }>;
  stop: Card[];
  skipStop: Card[];
  /** #1406: Update from the base takes the idle cards with a branch; the rest stay out, named. */
  update: Card[];
  skipUpdate: Array<{ card: Card; reason: string }>;
}

const skipReason = (t: T, block: "queued" | "running") =>
  t(block === "queued" ? "board.startQueued" : "board.startRunning");

/** Start takes the cards neither running nor queued; Stop takes the ones that are (`stopCard`). */
export function bulkSplit(cards: Card[], t: T): BulkSplit {
  const split: BulkSplit = {
    start: [],
    skipStart: [],
    stop: [],
    skipStop: [],
    update: [],
    skipUpdate: [],
  };
  for (const card of cards) {
    const block = cardStartBlock(card);
    if (block === null) {
      split.start.push(card);
      split.skipStop.push(card);
    } else {
      split.skipStart.push({ card, reason: skipReason(t, block) });
      split.stop.push(card);
    }
    if (block !== null) split.skipUpdate.push({ card, reason: skipReason(t, block) });
    else if (!card.branch || !card.worktreePath) {
      split.skipUpdate.push({ card, reason: t("board.updateNoBranch") });
    } else split.update.push(card);
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
 * holds new cards and is at its limit, and the host's own memory hold. The memory hold comes from the
 * host's own verdict when the confirm opened (`memoryOver`, #1414) or a queued card's reason, since the
 * host goes on holding a margin under its share. A hold the host does not report adds no line.
 */
export function holdLines(
  t: T,
  host: string,
  input: { budgets: Budget[]; projectKey: string | null; cards: Card[]; memoryOver?: boolean },
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
  if (input.memoryOver || reported("memory")) lines.push(t("board.startMemoryHold", { host }));
  return lines;
}

/** #1406: what Update from the base did to one card. */
export type UpdateOutcome = "updated" | "current" | "conflicted" | "failed";

export interface UpdateResult {
  card: Card;
  outcome: UpdateOutcome;
  /** The host's refusal, for a conflicted or failed card. */
  message?: string;
  reason?: string;
  params?: Record<string, string | number>;
}

export interface UpdateSteps {
  /** How many commits of its base the card lacks; null when the host could not say. */
  behind(card: Card): Promise<number | null>;
  /** Rebases the card on its base (`card.updateFromBase`). */
  update: CardRequest;
  /** After each card: how many are done, of how many. */
  onProgress?(done: number, total: number): void;
}

/** Updates the cards from their base one after the other; a conflict stops only its own card. */
export async function updateMany(cards: Card[], steps: UpdateSteps): Promise<UpdateResult[]> {
  const results: UpdateResult[] = [];
  for (const card of cards) {
    results.push(await updateOne(card, steps)); // NOSONAR: one card at a time, so the host never runs two rebases at once
    steps.onProgress?.(results.length, cards.length);
  }
  return results;
}

/**
 * A card already on its base is not rebased; one whose count is unknown is tried. A step that
 * throws (a dropped link) fails that card, and the run goes on.
 */
async function updateOne(card: Card, steps: UpdateSteps): Promise<UpdateResult> {
  try {
    return await tryUpdate(card, steps);
  } catch (error) {
    return {
      card,
      outcome: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function tryUpdate(card: Card, steps: UpdateSteps): Promise<UpdateResult> {
  if ((await steps.behind(card)) === 0) return { card, outcome: "current" };
  const answer = await steps.update(card);
  if (answer.ok) return { card, outcome: "updated" };
  const { ok: _, ...refusal } = answer;
  return {
    card,
    outcome: refusal.reason === "rebase_conflict" ? "conflicted" : "failed",
    ...refusal,
  };
}

/** The summary after Update from the base: updated, already current, conflicted, not updated. */
export function updateSummary(t: T, results: UpdateResult[]): string {
  const named = (outcome: UpdateOutcome, why: boolean) =>
    results
      .filter((r) => r.outcome === outcome)
      .map((r) => {
        if (!why) return r.card.title;
        // The reason is a sentence; inside the brackets it loses its full stop.
        const text = reasonText(t, r.message ?? "", r.reason, r.params).replace(/\.$/, "");
        return `${r.card.title} (${text})`;
      })
      .join(", ");
  const groups: Array<
    [
      UpdateOutcome,
      boolean,
      (
        | "board.updatedNames"
        | "board.currentNames"
        | "board.conflictedNames"
        | "board.notUpdatedNames"
      ),
    ]
  > = [
    ["updated", false, "board.updatedNames"],
    ["current", false, "board.currentNames"],
    ["conflicted", true, "board.conflictedNames"],
    ["failed", true, "board.notUpdatedNames"],
  ];
  return groups
    .map(([outcome, why, key]) => {
      const names = named(outcome, why);
      return names ? t(key, { names }) : "";
    })
    .filter(Boolean)
    .join(" ");
}
