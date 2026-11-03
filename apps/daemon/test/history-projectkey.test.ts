import { afterEach, describe, expect, test } from "bun:test";
import { Command } from "@flightdeck/protocol";
import { HistoryIndexer } from "../src/history/indexer.ts";
import { type RunningServer, startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager } from "./helpers.ts";
import { FrameClient, projectsRoot, userLine, writeTranscript } from "./history-helpers.ts";

const TOKEN = "history-projectkey-token-01";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const REMOTE = "github.com/acme/repo";
const KEYS: Record<string, string> = {
  "/work/repo": REMOTE,
  "/work/repo-wt/feature": REMOTE,
  "/work/other": "host:h:/work/other",
};

function fixtures() {
  const root = projectsRoot();
  const sessions: Array<[string, string, string]> = [
    ["-a", "s-main", "/work/repo"],
    ["-b", "s-worktree", "/work/repo-wt/feature"],
    ["-c", "s-other", "/work/other"],
  ];
  sessions.forEach(([dir, id, cwd], i) => {
    writeTranscript(root, dir, id, [
      userLine({ uuid: `u${i}`, text: "hi", cwd, ts: `2026-09-0${i + 1}T10:00:00.000Z` }),
    ]);
  });
  return root;
}

function setup(): { index: HistoryIndexer; server: RunningServer } {
  const index = new HistoryIndexer({
    db: new EventStore(":memory:").db,
    roots: [fixtures()],
  });
  cleanups.push(() => index.stop());
  index.scan();
  const server = startServer({
    manager: newManager().manager,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
    history: index,
    projectKeyOf: async (cwd) => KEYS[cwd] ?? `host:h:${cwd}`,
  });
  cleanups.push(() => server.stop());
  return { index, server };
}

async function ids(client: FrameClient, payload: object) {
  const page = await client.data<{ sessions: Array<{ claudeSessionId: string }> }>(
    "history.list",
    payload,
  );
  return page?.sessions.map((s) => s.claudeSessionId);
}

describe("history-projectkey: history.list by project", () => {
  test("the protocol accepts a projectKey on history.list", () => {
    const parsed = Command.safeParse({
      id: "1",
      type: "history.list",
      payload: { projectKey: REMOTE },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && (parsed.data.payload as { projectKey?: string }).projectKey).toBe(
      REMOTE,
    );
    expect(
      Command.safeParse({ id: "1", type: "history.list", payload: { projectKey: "" } }).success,
    ).toBe(false);
  });

  test("the index lists its folders once, and filters by an exact list of them", () => {
    const { index } = setup();
    expect(index.distinctCwds().sort()).toEqual([
      "/work/other",
      "/work/repo",
      "/work/repo-wt/feature",
    ]);
    const only = index.list({ cwds: ["/work/repo", "/work/other"] });
    expect(only.sessions.map((s) => s.claudeSessionId).sort()).toEqual(["s-main", "s-other"]);
    expect(index.list({ cwds: [] }).sessions).toEqual([]);
  });

  test("a git-remote key covers the folder and its worktree; a folder key only its folder", async () => {
    const { server } = setup();
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    expect((await ids(client, { projectKey: REMOTE }))?.sort()).toEqual(["s-main", "s-worktree"]);
    expect(await ids(client, { projectKey: "host:h:/work/other" })).toEqual(["s-other"]);
    expect(await ids(client, { projectKey: "github.com/none/none" })).toEqual([]);
    // It narrows with the other filters.
    expect(await ids(client, { projectKey: REMOTE, to: "2026-09-01T23:00:00.000Z" })).toEqual([
      "s-main",
    ]);
    expect((await ids(client, {}))?.length).toBe(3);
  });
});
