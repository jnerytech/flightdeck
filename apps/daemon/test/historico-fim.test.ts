import { afterEach, describe, expect, test } from "bun:test";
import { HistoryIndexer } from "../src/history/indexer.ts";
import { type RunningServer, startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager } from "./helpers.ts";
import {
  assistantLine,
  FrameClient,
  projectsRoot,
  userLine,
  writeTranscript,
} from "./history-helpers.ts";

const TOKEN = "historico-fim-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function serveTranscript(total: number) {
  const root = projectsRoot();
  const lines = Array.from({ length: total }, (_, i) => {
    const ts = new Date(Date.UTC(2026, 8, 1, 10, 0, i)).toISOString();
    const opts = { uuid: `m${i}`, text: `mensagem ${i}`, cwd: "/home/dev/p", ts };
    return i % 2 === 0 ? userLine(opts) : assistantLine(opts);
  });
  writeTranscript(root, "-p", "longa", lines);
  const store = new EventStore(":memory:");
  const index = new HistoryIndexer({ db: store.db, roots: [root] });
  cleanups.push(() => index.stop());
  await index.scan();
  const { manager } = newManager();
  const server: RunningServer = startServer({
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

interface Got {
  messages: Array<{ uuid: string }>;
  cursor?: string;
  nextCursor: string | null;
  prevCursor: string | null;
}

describe("historico-fim", () => {
  test("tail answers the last page, with the cursor it starts at and the one before it", async () => {
    const client = await serveTranscript(120);
    const page = await client.data<Got>("history.get", {
      claudeSessionId: "longa",
      limit: 50,
      tail: true,
    });
    expect(page?.messages.map((m) => m.uuid)).toEqual(
      Array.from({ length: 50 }, (_, i) => `m${70 + i}`),
    );
    expect(page?.cursor).toBe("70");
    expect(page?.nextCursor).toBeNull();
    expect(page?.prevCursor).toBe("20");
  });

  test("a transcript shorter than a page is all of it, with nothing before", async () => {
    const client = await serveTranscript(30);
    const page = await client.data<Got>("history.get", {
      claudeSessionId: "longa",
      limit: 50,
      tail: true,
    });
    expect(page?.messages).toHaveLength(30);
    expect(page?.cursor).toBe("0");
    expect(page?.prevCursor).toBeNull();
    expect(page?.nextCursor).toBeNull();
  });

  test("without tail, or with a cursor, the page is the one asked for", async () => {
    const client = await serveTranscript(120);
    const first = await client.data<Got>("history.get", { claudeSessionId: "longa", limit: 50 });
    expect(first?.messages[0]?.uuid).toBe("m0");
    expect(first?.nextCursor).toBe("50");
    const cursor = await client.data<Got>("history.get", {
      claudeSessionId: "longa",
      limit: 50,
      cursor: "20",
      tail: true,
    });
    expect(cursor?.messages[0]?.uuid).toBe("m20");
  });
});
