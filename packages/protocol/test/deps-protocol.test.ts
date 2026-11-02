import { describe, expect, test } from "bun:test";
import { Card, Command, type CommandType } from "../src/index.ts";

/** A card as a daemon from before phase 31 sends it. */
const OLD_CARD = {
  id: "c1",
  projectId: "p1",
  title: "t",
  description: "d",
  column: "backlog",
  columnLocked: false,
  position: 1,
  slug: null,
  branch: null,
  worktreePath: null,
  prUrl: null,
  prState: null,
  checksState: null,
  queued: false,
  sessionId: null,
  sessionStatus: null,
  notice: null,
  discarded: false,
  runs: [],
  createdAt: "2026-11-02T00:00:00.000Z",
  updatedAt: "2026-11-02T00:00:00.000Z",
};

const parse = (type: CommandType, payload: unknown) =>
  Command.safeParse({ id: "1", type, payload });

describe("deps-protocol: the card's dependency fields", () => {
  test("a card from an older daemon parses, with no blockers and no auto-start", () => {
    const card = Card.parse(OLD_CARD);
    expect(card.blockedBy).toEqual([]);
    expect(card.blocking).toEqual([]);
    expect(card.waitingOn).toEqual([]);
    expect(card.unblockWhen).toBe("done");
    expect(card.autoStart).toBeNull();
    expect(card.unblockedAt).toBeNull();
  });

  test("a card with its dependency fields keeps them", () => {
    const card = Card.parse({
      ...OLD_CARD,
      blockedBy: ["a", "b"],
      blocking: ["z"],
      waitingOn: ["b"],
      unblockWhen: "merged",
      autoStart: { workflow: "feature" },
      unblockedAt: "2026-11-02T01:00:00.000Z",
    });
    expect(card.blockedBy).toEqual(["a", "b"]);
    expect(card.blocking).toEqual(["z"]);
    expect(card.waitingOn).toEqual(["b"]);
    expect(card.unblockWhen).toBe("merged");
    expect(card.autoStart).toEqual({ workflow: "feature" });
    expect(card.unblockedAt).toBe("2026-11-02T01:00:00.000Z");
  });

  test("a card refuses an unblockWhen that is not done or merged", () => {
    expect(Card.safeParse({ ...OLD_CARD, unblockWhen: "later" }).success).toBe(false);
  });
});

describe("deps-protocol: the commands", () => {
  test("card.create and card.update carry the blockers, the condition and the auto-start", () => {
    const deps = { blockedBy: ["a"], unblockWhen: "merged", autoStart: { workflow: null } };
    expect(
      parse("card.create", { projectId: "p", title: "t", description: "d", ...deps }).success,
    ).toBe(true);
    expect(parse("card.update", { cardId: "c", ...deps }).success).toBe(true);
    expect(parse("card.update", { cardId: "c", autoStart: null }).success).toBe(true);
  });

  test("card.update keeps the dependency fields in the parsed payload", () => {
    const parsed = parse("card.update", {
      cardId: "c",
      blockedBy: ["a", "b"],
      unblockWhen: "done",
    });
    expect(parsed.success && parsed.data.payload).toEqual({
      cardId: "c",
      blockedBy: ["a", "b"],
      unblockWhen: "done",
    });
  });

  test("a blockedBy that is not a list of ids, or a repeated one, is refused", () => {
    expect(parse("card.update", { cardId: "c", blockedBy: "a" }).success).toBe(false);
    expect(parse("card.update", { cardId: "c", blockedBy: ["a", "a"] }).success).toBe(false);
    expect(parse("card.update", { cardId: "c", unblockWhen: "never" }).success).toBe(false);
  });

  test("card.dismissUnblocked takes a card id", () => {
    expect(parse("card.dismissUnblocked", { cardId: "c" }).success).toBe(true);
    expect(parse("card.dismissUnblocked", {}).success).toBe(false);
  });
});
