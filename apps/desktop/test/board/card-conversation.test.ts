import { describe, expect, test } from "bun:test";
import { conversationShown } from "../../src/features/board/domain/card-conversation.ts";

const session = { id: "s1" };
const base = {
  tab: "conversation",
  openedStep: undefined,
  stepSession: null,
  session: null,
  sessionId: null,
};

describe("conversationShown", () => {
  test("the card's own session shows on the conversation tab", () => {
    expect(conversationShown({ ...base, session, sessionId: "s1" })).toBe(true);
  });

  test("a session without an id shows nothing", () => {
    expect(conversationShown({ ...base, session, sessionId: null })).toBe(false);
  });

  test("the diff tab never shows the conversation", () => {
    expect(conversationShown({ ...base, tab: "diff", session, sessionId: "s1" })).toBe(false);
  });

  test("an opened step with its session shows it", () => {
    const openedStep = { type: "agent" };
    expect(conversationShown({ ...base, openedStep, stepSession: session })).toBe(true);
  });

  test("an opened step without its session shows nothing", () => {
    expect(conversationShown({ ...base, openedStep: { type: "agent" } })).toBe(false);
  });

  test("an opened check shows its output, not the conversation", () => {
    const openedStep = { type: "check" };
    expect(
      conversationShown({ ...base, openedStep, stepSession: session, session, sessionId: "s1" }),
    ).toBe(false);
  });
});
