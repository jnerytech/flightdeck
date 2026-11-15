import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { startServer } from "../../src/server.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { session } from "../support/review-inline.ts";

// Real git and FakeRuntime turns: more than the default 5 s.
setDefaultTimeout(20_000);

const TOKEN = "review-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("revisao-inline", () => {
  test("review.add, review.list, review.update, review.remove e review.send pelo protocolo", async () => {
    const ctx = await session();
    const server = startServer({
      manager: ctx.manager,
      review: { changes: ctx.changes, comments: ctx.review },
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
    const target = ctx.target;
    const made = await client.data<{ id: string }>("review.add", {
      target,
      path: "a.txt",
      side: "new",
      lineStart: 1,
      lineEnd: 1,
      body: "um?",
    });
    expect(made?.id ?? "").not.toBe("");
    await client.request("review.update", { id: made?.id, body: "um!" });
    const other = await client.data<{ id: string }>("review.add", {
      target,
      path: "b.txt",
      side: "old",
      lineStart: 1,
      lineEnd: 1,
      body: "sai",
    });
    await client.request("review.remove", { id: other?.id });
    const listed = await client.data<{ comments: Array<{ body: string }> }>("review.list", {
      target,
    });
    expect(listed?.comments.map((c) => c.body)).toEqual(["um!"]);
    expect(await client.data("review.send", { target, language: "pt-BR" })).toMatchObject({
      via: "session",
      comments: 1,
      text: expect.stringContaining("Revisão das mudanças:"),
    });
  });
});
