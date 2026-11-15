import { describe, expect, test } from "bun:test";
import type { Automation, Issue } from "@flightdeck/protocol";
import { type ActDeps, act } from "../../src/automations/act.ts";
import type { AutomationEvent } from "../../src/automations/domain/event.ts";
import { UNTRUSTED_MARK } from "../../src/kernel/index.ts";

/** Records what `act` asks of the board, the auto-approver and the PR watch, in order. */
function rig(opts: { claim?: string | null; startFails?: boolean; cardOfIssue?: string } = {}) {
  const calls: string[] = [];
  const messages: Array<{ cardId: string; text: string }> = [];
  const descriptions: string[] = [];
  const deps = {
    board: {
      createCard: (_project: string, input: { title: string; description: string }) => {
        descriptions.push(input.description);
        calls.push("createCard");
        return { id: "new1" };
      },
      startCard: async (id: string) => {
        calls.push(`startCard ${id}`);
        if (opts.startFails) throw new Error("no runtime");
      },
      discardCard: async (id: string, force: boolean) => {
        calls.push(`discardCard ${id} ${force}`);
      },
      message: (cardId: string, text: string) => {
        calls.push(`message ${cardId}`);
        messages.push({ cardId, text });
      },
      cardForIssue: () => opts.cardOfIssue ?? null,
    },
    issues: { createCard: async () => ({ id: "from-issue" }) },
    autoApprove: {
      suspend: (key: string, why: string) => {
        calls.push(`suspend ${key} ${why}`);
      },
    },
    prWatch: { claims: () => opts.claim ?? null },
  } as unknown as ActDeps;
  return { deps, calls, messages, descriptions };
}

const auto = (action: Automation["action"]): Automation => ({
  id: "a1",
  projectId: "p1",
  name: "Rule",
  enabled: true,
  trigger: { type: "pr_comment" },
  action,
  maxRunsPerDay: 10,
  allowExternalAuthors: true,
  createdAt: "2026-11-15T00:00:00.000Z",
});

const comment = (external: boolean): AutomationEvent => ({
  type: "pr_comment",
  cardId: "c1",
  commentId: "k1",
  author: "ana",
  text: "fix the name",
  external,
});

describe("automations act: third-party content", () => {
  test("an external comment goes to the card marked as untrusted and suspends its auto-approval; an own one does neither", async () => {
    const outside = rig();
    const sent = await act(outside.deps, auto({ type: "send_to_card" }), comment(true));
    expect(sent).toEqual({ status: "ok", detail: "sent to card c1" });
    expect(outside.messages[0]?.text.startsWith(`${UNTRUSTED_MARK}\n\n`)).toBe(true);
    expect(outside.calls.at(-1)).toBe("suspend card:c1 third-party content sent by an automation");

    const own = rig();
    await act(own.deps, auto({ type: "send_to_card" }), comment(false));
    expect(own.messages[0]?.text.includes(UNTRUSTED_MARK)).toBe(false);
    expect(own.calls).toEqual(["message c1"]);
  });

  test("start_workflow for an external event: the mark sits between the action text and the content, and the card is suspended before it starts", async () => {
    const { deps, calls, descriptions } = rig();
    const action = auto({ type: "start_workflow", workflow: "fix", description: "Handle this" });
    const result = await act(deps, action, comment(true));
    expect(result).toEqual({ status: "ok", detail: "card new1" });
    expect(descriptions[0]).toBe(
      `Handle this\n\n${UNTRUSTED_MARK}\n\nComment by ana on the PR:\nfix the name`,
    );
    expect(calls).toEqual([
      "createCard",
      "suspend card:new1 third-party content sent by an automation",
      "startCard new1",
    ]);
  });

  test("a workflow that fails to start discards its card and lets the error out", async () => {
    const { deps, calls } = rig({ startFails: true });
    const action = auto({ type: "start_workflow", workflow: "fix" });
    await expect(act(deps, action, comment(false))).rejects.toThrow("no runtime");
    expect(calls).toEqual(["createCard", "startCard new1", "discardCard new1 true"]);
  });

  test("a card whose PR the watch already fixes is skipped with the watch's reason and gets no message", async () => {
    const { deps, calls } = rig({ claim: "the PR watch is fixing it" });
    const result = await act(deps, auto({ type: "send_to_card" }), comment(true));
    expect(result).toEqual({ status: "skipped", detail: "the PR watch is fixing it" });
    expect(calls).toEqual([]);
  });

  test("create_card makes the card of an issue once: an issue that already has one is skipped", async () => {
    const issue = { ref: "#7", labels: ["bug"], external: true } as unknown as Issue;
    const event: AutomationEvent = { type: "issue_label", projectId: "p1", issue };
    const fresh = rig();
    const made = await act(fresh.deps, auto({ type: "create_card" }), event);
    expect(made).toEqual({ status: "ok", detail: "card from-issue" });

    const taken = rig({ cardOfIssue: "c9" });
    const skipped = await act(taken.deps, auto({ type: "create_card" }), event);
    expect(skipped).toEqual({ status: "skipped", detail: "issue #7 already has card c9" });
    expect(taken.calls).toEqual([]);
  });
});
