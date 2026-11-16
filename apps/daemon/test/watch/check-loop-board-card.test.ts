import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { startServer } from "../../src/server.ts";
import { cardWhen } from "../support/board-helpers.ts";
import { poll } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { cleanups, FAILED, PASSED, setup, teardown } from "./check-loop-board-setup.ts";

// Real git (a worktree per card): more than the default 5 s.
setDefaultTimeout(30_000);
afterEach(teardown);

describe("check-loop: the person's input over the protocol", () => {
  test("session.send and a persona switch on a card's session step its loop aside", async () => {
    const ctx = await setup();
    await ctx.board.startCard(ctx.card.id);
    await cardWhen(ctx.board, ctx.card.id, (c) => c.column === "review");
    const sessionId = ctx.board.getCard(ctx.card.id).sessionId as string;
    const stepped: string[] = [];
    ctx.board.personTurnOfSession = (id: string) => {
      stepped.push(id);
    };
    const token = "check-loop-board-token-0123456789ab";
    const server = startServer({
      manager: ctx.manager,
      board: ctx.board,
      personas: { sessions: { apply: async () => ({}), clear: async () => ({}) } as never },
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token,
      allowedRoots: [ctx.root],
    });
    const client = new FrameClient(server.url);
    cleanups.push(async () => {
      client.close();
      await server.stop();
    });
    await client.request("hello", { token, client: "t" });
    ctx.manager.sessionOfRequest = () => sessionId;
    await client.request("session.send", { sessionId, text: "olha isso" });
    await client.request("session.applyPersona", { sessionId, persona: { id: "seg" } });
    await client.request("session.clearPersona", { sessionId });
    await client.request("session.interrupt", { sessionId });
    // An unknown request is refused after the lookup; the person's answer still counts first.
    await client.request("permission.respond", { requestId: "req-1", decision: "deny" });
    expect(stepped).toEqual([sessionId, sessionId, sessionId, sessionId, sessionId]);
  });
});

describe("check-loop: what the card says about its loop", () => {
  test("the card shows the loop checking, then the round it sent, then how it ended, and each step is a card update", async () => {
    const ctx = await setup([FAILED, PASSED]);
    ctx.switchOn(ctx.card.id);
    const seen: Array<string | null> = [];
    const sentBox: { last: { active: string | null; state: string | null } | null } = {
      last: null,
    };
    ctx.board.watch((card) => {
      if (card.id !== ctx.card.id) return;
      seen.push(card.checkLoop?.active ?? null);
      sentBox.last = {
        active: card.checkLoop?.active ?? null,
        state: card.checkLoop?.last?.state ?? null,
      };
    });
    const open = ctx.holdChecks();
    await ctx.board.startCard(ctx.card.id);
    await poll(() => ctx.ran.length === 1, 10_000);
    const checking = ctx.board.getCard(ctx.card.id).checkLoop;
    open();
    await poll(() => ctx.board.getCard(ctx.card.id).checkLoop?.active === "fixing", 10_000);
    const fixing = ctx.board.getCard(ctx.card.id).checkLoop;
    await cardWhen(ctx.board, ctx.card.id, (c) => c.column === "review");
    const ended = ctx.board.getCard(ctx.card.id).checkLoop;
    expect([
      checking?.active,
      [
        fixing?.active,
        fixing?.round,
        fixing?.max,
        fixing?.last?.state,
        fixing?.last?.command,
        fixing?.last?.exitCode,
      ],
      [ended?.active, ended?.last?.state, ended?.last?.reason],
      seen.includes("checking") && seen.includes("fixing"),
      // The last card the app was sent agrees with the end: not active any more.
      sentBox.last,
    ]).toEqual([
      "checking",
      ["fixing", 1, 3, "sent", "bun test", 1],
      [null, "ended", "passed"],
      true,
      { active: null, state: "ended" },
    ]);
  });

  test("an end with no placement (a stop) still sends a card that is no longer active", async () => {
    const ctx = await setup([FAILED]);
    ctx.switchOn(ctx.card.id);
    const sentBox: { last: { active: string | null; reason: string | null } | null } = {
      last: null,
    };
    ctx.board.watch((card) => {
      if (card.id !== ctx.card.id) return;
      sentBox.last = {
        active: card.checkLoop?.active ?? null,
        reason: card.checkLoop?.last?.reason ?? null,
      };
    });
    ctx.holdChecks();
    await ctx.board.startCard(ctx.card.id);
    await poll(() => ctx.ran.length === 1, 10_000);
    await ctx.board.stopCard(ctx.card.id);
    expect(sentBox.last).toEqual({ active: null, reason: "stopped_by_you" });
  });

  test("a session that ends while its checks run sends a last card that is no longer active", async () => {
    const ctx = await setup([FAILED]);
    ctx.switchOn(ctx.card.id);
    const sentBox: { last: { active: string | null; reason: string | null } | null } = {
      last: null,
    };
    ctx.board.watch((card) => {
      if (card.id !== ctx.card.id) return;
      sentBox.last = {
        active: card.checkLoop?.active ?? null,
        reason: card.checkLoop?.last?.reason ?? null,
      };
    });
    ctx.holdChecks();
    await ctx.board.startCard(ctx.card.id);
    await poll(() => ctx.ran.length === 1, 10_000);
    await ctx.manager.close(ctx.board.getCard(ctx.card.id).sessionId as string);
    await poll(() => sentBox.last?.reason === "session_ended", 5000);
    expect(sentBox.last).toEqual({ active: null, reason: "session_ended" });
  });

  test("a card with the switch off carries no loop line, so reading it asks the rounds table nothing", async () => {
    const ctx = await setup();
    expect(ctx.board.getCard(ctx.card.id).checkLoop).toEqual({
      on: false,
      rounds: null,
      confirmed: false,
    });
  });
});

describe("check-loop: input from any path", () => {
  test("a message reaching the card's session by any path while its checks run steps the loop aside", async () => {
    const ctx = await setup([PASSED]);
    ctx.switchOn(ctx.card.id);
    const open = ctx.holdChecks();
    await ctx.board.startCard(ctx.card.id);
    await poll(() => ctx.ran.length === 1, 10_000);
    const sessionId = ctx.board.getCard(ctx.card.id).sessionId as string;
    // As a review comment, a message between sessions or a persona hand-off write it.
    ctx.manager.send(sessionId, "um comentário de revisão");
    open();
    await cardWhen(ctx.board, ctx.card.id, (c) => c.column === "review");
    expect(ctx.rounds(ctx.card.id)[0]?.reason).toBe("person_turn");
  });
});

describe("check-loop: the person's input over the protocol, end to end", () => {
  test("session.send into a card whose checks run ends its loop as the person's turn", async () => {
    const ctx = await setup([PASSED]);
    ctx.switchOn(ctx.card.id);
    const open = ctx.holdChecks();
    await ctx.board.startCard(ctx.card.id);
    await poll(() => ctx.ran.length === 1, 10_000);
    const sessionId = ctx.board.getCard(ctx.card.id).sessionId as string;
    const token = "check-loop-board-token-0123456789cd";
    const server = startServer({
      manager: ctx.manager,
      board: ctx.board,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token,
      allowedRoots: [ctx.root],
    });
    const client = new FrameClient(server.url);
    cleanups.push(async () => {
      client.close();
      await server.stop();
    });
    await client.request("hello", { token, client: "t" });
    await client.request("session.send", { sessionId, text: "eu mesmo vejo" });
    open();
    await cardWhen(ctx.board, ctx.card.id, (c) => c.column === "review");
    expect(ctx.rounds(ctx.card.id)[0]?.reason).toBe("person_turn");
  });
});
