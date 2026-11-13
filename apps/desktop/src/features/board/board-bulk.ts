import type { Budget, Card, ContractOverrides } from "@flightdeck/protocol";
import { reasonText } from "../../i18n/errors.ts";
import type { T } from "../../i18n/index.ts";
import { onSubscription, quotaBars } from "../quota/index.ts";
import { answerOf, type BulkRefusal } from "./board-select.ts";
import { startNeeds } from "./domain/board-contracts.ts";
import { cardStartBlock } from "./domain/card-start-block.ts";

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
  input: {
    budgets: Budget[];
    projectKey: string | null;
    cards: Card[];
    memoryOver?: boolean;
    /** The host is paused (#1481): a hold like the others. */
    paused?: boolean;
  },
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
  if (input.paused) lines.push(t("board.startPausedHold", { host }));
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

/** What the board's bulk bar runs on the selection. */
export type BulkKind = "start" | "stop";

/** The confirm's title: how many cards the action takes. */
export function bulkTitle(t: T, kind: BulkKind, counts: Record<BulkKind, number>): string {
  const count = counts[kind];
  if (kind === "start") {
    return count === 1 ? t("board.startTitleOne") : t("board.startTitle", { n: count });
  }
  return count === 1 ? t("board.stopTitleOne") : t("board.stopTitle", { n: count });
}

/** Why the action leaves a selected card out, for the confirm's list; undefined when it takes it. */
export function bulkSkipReason(
  t: T,
  kind: BulkKind,
  split: BulkSplit,
  card: Card,
  needsInputs: boolean,
): string | undefined {
  if (kind === "stop") {
    return split.skipStop.some((c) => c.id === card.id) ? t("board.notRunning") : undefined;
  }
  const skipped = split.skipStart.find((s) => s.card.id === card.id)?.reason;
  if (skipped) return skipped;
  return needsInputs ? t("board.needsInputs") : undefined;
}

/** What a host's answer to one card's request means to a bulk run: went, or refused with its reason. */
export function requestResult(
  answer: { ok: true } | ({ ok: false } & Parameters<typeof answerOf>[0]),
): Awaited<ReturnType<CardRequest>> {
  return answer.ok ? { ok: true } : { ok: false, ...answerOf(answer) };
}

/** The notice after a bulk run: the refused cards named, in the one or many wording, or null when none. */
export function refusalNotice(
  t: T,
  refused: BulkRefusal[],
  names: string,
  keys: { one: Parameters<T>[0]; many: Parameters<T>[0] },
): string | null {
  if (refused.length === 0) return null;
  if (refused.length === 1) return t(keys.one, { names });
  return t(keys.many, { count: refused.length, names });
}

const RUN_FAILED = {
  start: { one: "board.startFailedOne", many: "board.startFailed" },
  stop: { one: "board.stopFailedOne", many: "board.stopFailed" },
} as const;

/** The notice after Start or Stop ran: the refused cards named, or null when none was. */
export function bulkRunOutcome(
  t: T,
  kind: BulkKind,
  refused: BulkRefusal[],
  names: string,
): string | null {
  return refusalNotice(t, refused, names, RUN_FAILED[kind]);
}

/** What the Start confirm says about the host's quota, and whether a window is hot enough to hold new cards. */
export function startQuotaLines(
  t: T,
  host: string,
  input: {
    quota: Parameters<typeof quotaBars>[0];
    account: Parameters<typeof onSubscription>[1];
    now: number;
    formatTime: (iso: string) => string;
  },
): { lines: string[]; holds: string[] } {
  if (!onSubscription(input.quota, input.account)) return { lines: [], holds: [] };
  const bars = quotaBars(input.quota, input.now, input.formatTime, t);
  const fiveHour = bars[0];
  const lines = fiveHour?.hasReading
    ? [t("board.startQuota", { host, percent: fiveHour.percent, reset: fiveHour.reset })]
    : [];
  const holds = bars.some((bar) => bar.hot) ? [t("board.startQuotaHold", { host })] : [];
  return { lines, holds };
}

/** The Start confirm's lines about the cards: the queue, the quota, the holds, the other hosts and the criteria. */
export function startConfirmLines(
  t: T,
  input: {
    workflowsFailed: boolean;
    queueMax: number | null | undefined;
    startable: Card[];
    runningOnHost: number;
    quotaLines: string[];
    holds: string[];
    /** The cards that would wait here, when another host could take them. */
    waitingElsewhere: number;
    contracts: ContractOverrides;
  },
): string[] {
  const { startable, queueMax } = input;
  const lines: string[] = input.workflowsFailed ? [t("board.workflowsUnread")] : [];
  if (queueMax !== undefined) {
    const split =
      input.holds.length > 0
        ? { now: 0, later: startable.length }
        : queueSplit(startable.length, queueMax ?? 0, input.runningOnHost);
    lines.push(queueLine(t, split, queueMax));
  }
  lines.push(...input.quotaLines, ...input.holds);
  if (input.waitingElsewhere === 1) lines.push(t("board.startOnHintOne"));
  else if (input.waitingElsewhere > 1) {
    lines.push(t("board.startOnHint", { n: input.waitingElsewhere }));
  }
  const lacking = startable.filter((card) => startNeeds(card, input.contracts).length > 0).length;
  if (lacking === 1) lines.push(t("board.noCriteriaOne"));
  else if (lacking > 1) lines.push(t("board.noCriteria", { n: lacking }));
  return lines;
}

/**
 * The other hosts a Start that would wait can go to: asked only while the Start confirm is open.
 * The caller passes `null` until that confirm is ready.
 */
export function startOffers<Offer>(kind: BulkKind | null, offers: () => Offer[]): Offer[] {
  return kind === "start" ? offers() : [];
}
