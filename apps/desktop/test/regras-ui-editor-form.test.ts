import { describe, expect, test } from "bun:test";
import { draftOf, move, newDraft, ruleOf } from "../src/lib/vault-rules-form.ts";

describe("regras-ui-editor: a rule as the editor holds it and as the daemon reads it", () => {
  test("only the fields that are set go to the daemon", () => {
    const draft = {
      ...newDraft([]),
      requester: "claude" as const,
      action: "deploy-*",
      decision: "allow" as const,
    };
    expect(ruleOf(draft)).toEqual({
      id: "r1",
      match: { requester: "claude", action: "deploy-*" },
      decision: "allow",
    });
  });

  test("tags are split by comma, a window needs days and both times, once goes only with ask, limits are numbers", () => {
    const draft = {
      ...newDraft([]),
      tags: " prod , api ,",
      decision: "ask" as const,
      once: true,
      days: ["mon", "fri"] as const,
      from: "08:00",
      to: "18:00",
      outsideWindow: "deny" as const,
      maxPerHour: "5",
      maxPerDay: "",
    };
    expect(ruleOf({ ...draft, days: [...draft.days] })).toEqual({
      id: "r1",
      match: { tags: ["prod", "api"] },
      decision: "ask",
      once: "session",
      window: { days: ["mon", "fri"], from: "08:00", to: "18:00" },
      outsideWindow: "deny",
      maxPerHour: 5,
    });
    // once is dropped when the decision is not ask; no window without its days.
    expect(
      ruleOf({ ...newDraft([]), decision: "allow", once: true, from: "08:00", to: "18:00" }),
    ).toEqual({
      id: "r1",
      match: {},
      decision: "allow",
    });
  });

  test("a rule goes to the editor and back unchanged, its expiry included", () => {
    const rule = {
      id: "r7",
      match: {
        requester: "automation",
        purpose: "action",
        host: "pi",
        project: "github.com/a/b",
        session: "s1",
        tags: ["prod"],
      },
      decision: "ask",
      once: "session",
      window: { days: ["sat", "sun"], from: "22:00", to: "06:00" },
      outsideWindow: "allow",
      maxPerHour: 2,
      maxPerDay: 10,
      expiresAt: new Date(2026, 9, 30, 17, 0).getTime(),
    };
    expect(draftOf(rule).expiresAt).toBe("2026-10-30T17:00");
    expect(ruleOf(draftOf(rule))).toEqual(rule);
  });

  test("a new rule gets an id the list does not use", () => {
    const first = newDraft([]);
    expect(first.id).toBe("r1");
    expect(newDraft([first, { ...first, id: "r7" }]).id).toBe("r8");
    expect(newDraft([{ ...first, id: "deploy" }]).id).toBe("r1");
  });

  test("move takes an item to another place", () => {
    expect(move(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(move(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(move(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});
