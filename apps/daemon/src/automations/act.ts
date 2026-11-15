/**
 * What a fired automation does with an event: sends it to a card, makes a card from an issue or
 * starts a workflow on a new card. Content from a third party goes marked as untrusted and the
 * automatic approval stays suspended on the card it reached.
 */
import type { Automation, Issue } from "@flightdeck/protocol";
import type { Board } from "../board/index.ts";
import type { Issues } from "../issues/index.ts";
import { UNTRUSTED_MARK } from "../kernel/index.ts";
import type { AutoApprover } from "../permissions/index.ts";
import { type AutomationEvent, contentOf, isExternal } from "./domain/event.ts";

/** What `act` needs from the daemon: the board, the issues, the auto-approver and the PR watch. */
export interface ActDeps {
  board: Board;
  issues: Pick<Issues, "createCard">;
  autoApprove?: Pick<AutoApprover, "suspend">;
  /** Issue #77: a card whose PR is watched is fixed by the watch alone; why, or null. */
  prWatch?: { claims(cardId: string): string | null };
}

type Outcome = { status: "ok" | "skipped"; detail: string };

export async function act(
  deps: ActDeps,
  auto: Automation,
  event: AutomationEvent,
): Promise<Outcome> {
  const { board } = deps;
  const { action } = auto;
  if (action.type === "create_card") {
    // Saved only with an issue_label trigger (see `check`), so this event always has an issue.
    const { issue } = event as Extract<AutomationEvent, { type: "issue_label" }>;
    return cardFromIssue(deps, auto, issue, (card) => Promise.resolve(`card ${card}`));
  }
  if (action.type === "start_workflow") {
    const inputs = action.inputs;
    const start = async (cardId: string) => {
      await board.startCard(cardId, { workflow: action.workflow, ...(inputs ? { inputs } : {}) });
      return `card ${cardId}`;
    };
    if (event.type === "issue_label") return cardFromIssue(deps, auto, event.issue, start);
    const external = isExternal(event);
    const content = contentOf(event);
    const description = [action.description ?? "", external ? UNTRUSTED_MARK : "", content]
      .filter((part) => part.trim() !== "")
      .join("\n\n");
    const projectId = auto.projectId;
    const card = board.createCard(projectId, { title: action.title ?? auto.name, description });
    if (external) suspend(deps, card.id);
    try {
      return { status: "ok", detail: await start(card.id) };
    } catch (error) {
      // A card that never started has nothing to keep: no orphan in the Backlog.
      await board.discardCard(card.id, true);
      throw error;
    }
  }
  if (!("cardId" in event)) return { status: "skipped", detail: "the event is not about a card" };
  // The watch fixes a watched PR (#77): a second fix of the same failure would race it.
  const claimed = deps.prWatch?.claims(event.cardId) ?? null;
  if (claimed) return { status: "skipped", detail: claimed };
  const external = isExternal(event);
  const text = external ? `${UNTRUSTED_MARK}\n\n${contentOf(event)}` : contentOf(event);
  board.message(event.cardId, text);
  if (external) suspend(deps, event.cardId);
  return { status: "ok", detail: `sent to card ${event.cardId}` };
}

/** The card of an issue, made now; an issue that already has one is skipped. */
async function cardFromIssue(
  deps: ActDeps,
  auto: Automation,
  issue: Issue,
  then: (cardId: string) => Promise<string>,
): Promise<Outcome> {
  const existing = deps.board.cardForIssue(auto.projectId, issue.ref);
  if (existing)
    return { status: "skipped", detail: `issue ${issue.ref} already has card ${existing}` };
  const card = await deps.issues.createCard(auto.projectId, issue.ref);
  return { status: "ok", detail: await then(card.id) };
}

/** Content from a third party reached the card: nothing there is approved automatically. */
function suspend(deps: ActDeps, cardId: string): void {
  deps.autoApprove?.suspend(`card:${cardId}`, "third-party content sent by an automation");
}
