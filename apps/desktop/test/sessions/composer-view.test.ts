import { describe, expect, test } from "bun:test";
import { commandItemsOf } from "../../src/features/sessions/command-menu.ts";
import { queueStep, submitAction } from "../../src/features/sessions/domain/composer-queue.ts";
import {
  missedAfter,
  rememberPosition,
  type ScrollPosition,
} from "../../src/features/sessions/domain/scroll-memory.ts";

/**
 * #1605 (Humble Object): what SessionView decides about the scroll memory and the composer queue,
 * tested by output and without the DOM.
 */
const at = (top: number): ScrollPosition => ({ top, atEnd: false, seq: top });

describe("scroll memory", () => {
  test("remembers where a conversation was left, and a second visit replaces it", () => {
    const positions = new Map<string, ScrollPosition>();
    rememberPosition(positions, "a", at(10), 200);
    rememberPosition(positions, "a", at(40), 200);
    expect(positions.get("a")).toEqual(at(40));
    expect(positions.size).toBe(1);
  });

  test("a conversation seen again becomes the newest, so the oldest go first", () => {
    const positions = new Map<string, ScrollPosition>();
    rememberPosition(positions, "a", at(1), 2);
    rememberPosition(positions, "b", at(2), 2);
    rememberPosition(positions, "a", at(3), 2);
    rememberPosition(positions, "c", at(4), 2);
    expect([...positions.keys()]).toEqual(["a", "c"]);
  });

  test("holds no more than the cap", () => {
    const positions = new Map<string, ScrollPosition>();
    for (let i = 0; i < 5; i++) rememberPosition(positions, `k${i}`, at(i), 3);
    expect([...positions.keys()]).toEqual(["k2", "k3", "k4"]);
  });
});

describe("messages missed while away", () => {
  const items = [{ seq: 1 }, { seq: 2 }, { seq: 3 }, { seq: 4 }];

  test("counts the messages after the one the reader saw last", () => {
    expect(missedAfter(items, 2)).toBe(2);
    expect(missedAfter(items, 4)).toBe(0);
  });

  test("a reader at the end missed none", () => {
    expect(missedAfter(items, null)).toBe(0);
  });
});

describe("the composer queue", () => {
  const idle = { working: false, closed: false, hasNext: true, awaiting: null, cards: 7 };

  test("sends the next message when the session is idle, and waits for its turn to show up", () => {
    expect(queueStep(idle)).toEqual({ awaiting: 7, send: true });
  });

  test("sends nothing while the session works, is closed or the queue is empty", () => {
    expect(queueStep({ ...idle, working: true }).send).toBe(false);
    expect(queueStep({ ...idle, closed: true }).send).toBe(false);
    expect(queueStep({ ...idle, hasNext: false }).send).toBe(false);
  });

  test("waits for the turn of the message it sent: the conversation has not grown", () => {
    expect(queueStep({ ...idle, awaiting: 7 })).toEqual({ awaiting: 7, send: false });
  });

  test("the turn showed up once the conversation grew, and the next message goes out", () => {
    expect(queueStep({ ...idle, awaiting: 6 })).toEqual({ awaiting: 7, send: true });
  });

  test("the turn showed up once the session worked, and the wait is over", () => {
    expect(queueStep({ ...idle, working: true, awaiting: 7 })).toEqual({
      awaiting: null,
      send: false,
    });
  });
});

describe("a press on Send", () => {
  test("with nothing written and nothing attached, it only focuses the box", () => {
    expect(submitAction("", 0, false)).toBe("focus");
    expect(submitAction("", 0, true)).toBe("focus");
  });

  test("during a turn, the message is queued", () => {
    expect(submitAction("hi", 0, true)).toBe("queue");
  });

  test("otherwise it is sent, an image alone being enough", () => {
    expect(submitAction("hi", 0, false)).toBe("send");
    expect(submitAction("", 1, false)).toBe("send");
  });
});

describe("the slash commands as menu items", () => {
  test("a daemon that only names them gets plain items without a group", () => {
    expect(commandItemsOf(undefined, ["compact", "review"])).toEqual([
      { key: "slash:compact", name: "/compact" },
      { key: "slash:review", name: "/review" },
    ]);
    expect(commandItemsOf(undefined, undefined)).toEqual([]);
  });

  test("a daemon that describes them gets the group of each kind, and the description when it has one", () => {
    expect(
      commandItemsOf(
        [
          { name: "compact", kind: "builtin", description: "Shrink the context" },
          { name: "fix", kind: "skill", description: "" },
          { name: "mcp__db__q", kind: "mcp", description: "" },
        ],
        ["ignored"],
      ),
    ).toEqual([
      {
        key: "slash:compact",
        name: "/compact",
        description: "Shrink the context",
        group: "commands",
      },
      { key: "slash:fix", name: "/fix", group: "skills" },
      { key: "slash:mcp__db__q", name: "/mcp__db__q", group: "mcp" },
    ]);
  });
});
