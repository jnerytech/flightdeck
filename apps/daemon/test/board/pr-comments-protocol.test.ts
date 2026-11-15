import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { startServer } from "../../src/server.ts";
import {
  cardWithPr,
  cleanups,
  fake,
  GH_RULES,
  GH_URL,
  runCleanups,
} from "../support/board-pr-comments.ts";
import { FrameClient } from "../support/history-helpers.ts";

// Real git and fake CLIs (each one a Bun process): more than the default 5 s.
setDefaultTimeout(30_000);

const TOKEN = "pr-comments-token-0123456789abcdef";
afterEach(runCleanups);

describe("pr-comments over the wire", () => {
  test("pr.comments e pr.comments.send pelo protocolo", async () => {
    fake("gh", GH_RULES);
    const ctx = await cardWithPr("github", GH_URL);
    const server = startServer({
      manager: ctx.manager,
      board: ctx.board,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [ctx.root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const got = await client.data<{ comments: Array<{ id: string }> }>("pr.comments", {
      cardId: ctx.cardId,
    });
    expect(got?.comments.map((c) => c.id)).toEqual(["101", "102", "review-R_1"]);
    expect(await client.data("pr.comments.send", { cardId: ctx.cardId, ids: ["102"] })).toEqual({
      sent: 1,
    });
    expect(
      await client.request("pr.comments.send", { cardId: ctx.cardId, ids: ["nada"] }),
    ).toMatchObject({ ok: false, error: { code: "bad_request" } });
  });
});
