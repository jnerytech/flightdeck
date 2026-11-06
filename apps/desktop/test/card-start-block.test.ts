import { describe, expect, test } from "bun:test";
import { cardStartBlock } from "../src/lib/card-start-block.ts";

const card = (over: { queued?: boolean; sessionStatus?: string | null }) =>
  ({ queued: false, sessionStatus: null, ...over }) as never;

describe("card-start-block: why the card menu's Start is off", () => {
  test("a queued card is queued, whatever its session says", () => {
    expect(cardStartBlock(card({ queued: true }))).toBe("queued");
    expect(cardStartBlock(card({ queued: true, sessionStatus: "running" }))).toBe("queued");
  });

  test("a card with a live session is running", () => {
    for (const status of ["starting", "running", "awaiting_permission"]) {
      expect(cardStartBlock(card({ sessionStatus: status }))).toBe("running");
    }
  });

  test("a card with no session, an idle one or an ended one can be started", () => {
    for (const status of [null, "idle", "ended", "error"]) {
      expect(cardStartBlock(card({ sessionStatus: status }))).toBeNull();
    }
  });
});
