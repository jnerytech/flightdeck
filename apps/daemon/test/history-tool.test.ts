import { afterEach, describe, expect, test } from "bun:test";
import { HistoryIndexer } from "../src/history/indexer.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager } from "./helpers.ts";
import { FrameClient, projectsRoot, writeTranscript } from "./history-helpers.ts";

const TOKEN = "history-tool-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const json = (value: unknown) => JSON.stringify(value);

/** A stored session whose assistant ran Bash and got its result, then ran one with no result yet. */
async function serve() {
  const root = projectsRoot();
  const meta = { cwd: "/home/dev/p", timestamp: "2026-11-06T10:00:00.000Z" };
  writeTranscript(root, "-p", "s1", [
    json({ ...meta, type: "user", uuid: "q1", message: { role: "user", content: "list it" } }),
    json({
      ...meta,
      type: "assistant",
      uuid: "a1",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls -la /srv" } }],
      },
    }),
    json({
      ...meta,
      type: "user",
      uuid: "r1",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "total 0" }],
      },
    }),
  ]);
  const store = new EventStore(":memory:");
  const index = new HistoryIndexer({ db: store.db, roots: [root] });
  cleanups.push(() => index.stop());
  await index.scan();
  const { manager } = newManager();
  const server = startServer({
    manager,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
    history: index,
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return client;
}

describe("history-tool: the reader opens a stored tool call to its input and result (#606)", () => {
  test("the host announces history.tool and answers it from the session's own transcript", async () => {
    const client = await serve();
    const info = await client.data<{ features?: string[] }>("host.info", {});
    expect(info?.features ?? []).toContain("history.tool");
    const got = await client.data<{ tool: unknown }>("history.tool", {
      claudeSessionId: "s1",
      uuid: "a1",
      index: 0,
    });
    expect(got?.tool).toEqual({
      name: "Bash",
      input: { command: "ls -la /srv" },
      result: { content: "total 0", isError: false },
      truncated: false,
    });
  });

  test("a call the transcript does not have is none; a session never indexed is refused", async () => {
    const client = await serve();
    const none = await client.data<{ tool: unknown }>("history.tool", {
      claudeSessionId: "s1",
      uuid: "q1",
      index: 0,
    });
    const ack = await client.request("history.tool", {
      claudeSessionId: "nope",
      uuid: "a1",
      index: 0,
    });
    const error = ack.error as { reason?: string } | undefined;
    expect([none?.tool ?? "missing", error?.reason ?? "none"]).toEqual([
      null,
      "transcript_not_indexed",
    ]);
  });
});
