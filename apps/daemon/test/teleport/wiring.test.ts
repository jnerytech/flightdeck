import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { HistoryIndexer } from "../src/history/indexer.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { type TeleportImportDeps, teleportImportDeps } from "../src/teleport/import.ts";
import { TeleportPackages, type TeleportSession, teleportDeps } from "../src/teleport/package.ts";
import { TeleportInbox } from "../src/teleport/receive.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient, projectsRoot, userLine, writeTranscript } from "./history-helpers.ts";

/**
 * Issue #100, slice 1: how the daemon wires a teleport. The transcript is the file the history
 * indexer recorded; the session, its team and the package folder come from the daemon's own parts;
 * the server answers `teleport.prepare`, `teleport.read` and `teleport.cancel` and announces
 * `teleport`, and a host without it refuses them as a feature that is off.
 */
const ID = "0b6f5c2e-6f0a-4c39-9a51-7c4f1d2e3a4b";
const TOKEN = "t".repeat(24);

/** A manager for an import whose sessions do not matter to the test. */
const stubManager = {
  createResumed: async () => ({ sessionId: "t1" }),
  list: () => [],
  close: async () => {},
};

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function indexed() {
  const root = projectsRoot();
  const file = writeTranscript(root, "-work-app", ID, [
    userLine({ uuid: "u1", text: "fix the login", cwd: "/work/app" }),
  ]);
  const store = new EventStore(":memory:");
  const indexer = new HistoryIndexer({ db: store.db, roots: [root] });
  cleanups.push(() => indexer.stop());
  await indexer.scan();
  return { root, file, indexer };
}

describe("teleport-wiring: the daemon's parts behind a teleport (#100)", () => {
  test("the indexer names the transcript file it recorded for a Claude session, and none for another", async () => {
    const { indexer, file } = await indexed();
    expect([
      indexer.transcriptFile(ID),
      indexer.transcriptFile("11111111-1111-4111-8111-111111111111"),
    ]).toEqual([file, null]);
  });

  test("the deps read the session, its team and its transcript from the daemon, and keep packages under the data dir", async () => {
    const { indexer, file, root } = await indexed();
    const session: TeleportSession = {
      id: "s1",
      cwd: "/work/app",
      status: "idle",
      permissionMode: "default",
      model: null,
      claudeSessionId: ID,
    };
    const deps = teleportDeps({
      manager: { get: () => session },
      names: { get: (id) => (id === "s1" ? ({ team: { name: "t" } } as never) : null) },
      indexer,
      historyRoots: [root],
      dataDir: "/data",
      scan: (text) => (text.includes("ghp_") ? ["token"] : []),
      log: () => {},
    });
    expect([
      deps.session("s1"),
      deps.inTeam("s1"),
      deps.inTeam("s2"),
      await deps.transcriptOf(ID),
      deps.dir,
      deps.historyRoots,
      deps.scan("ghp_x"),
      typeof deps.now(),
      new Set([deps.newId(), deps.newId()]).size,
      deps.timers === globalThis,
    ]).toEqual([
      session,
      true,
      false,
      file,
      join("/data", "teleport"),
      [root],
      ["token"],
      "number",
      2,
      true,
    ]);
  });

  test("a transcript the indexer has not recorded yet (one a move just brought in) is found on disk, under the history roots only", async () => {
    const root = projectsRoot();
    const store = new EventStore(":memory:");
    // Never scanned: as on a host whose indexer has not seen the file the import just wrote.
    const indexer = new HistoryIndexer({ db: store.db, roots: [root] });
    cleanups.push(() => indexer.stop());
    const file = writeTranscript(root, "-work-app-worktree", ID, [
      userLine({ uuid: "u1", text: "fix the login", cwd: "/work/app-worktree" }),
    ]);
    const deps = teleportDeps({
      manager: { get: () => null as never },
      names: { get: () => null },
      indexer,
      historyRoots: [root],
      dataDir: "/data",
      scan: () => [],
      log: () => {},
    });
    expect([
      await deps.transcriptOf(ID),
      await deps.transcriptOf("11111111-1111-4111-8111-111111111111"),
      await deps.transcriptOf("../-work-app-worktree"),
    ]).toEqual([file, null, null]);
  });

  test("the server announces teleport and answers prepare, read and cancel; without it they are off", async () => {
    const { manager } = newManager();
    const dir = tempDir("fd-teleport-");
    const packages = new TeleportPackages({
      session: () => ({
        id: "s1",
        cwd: "/work/app",
        status: "idle",
        permissionMode: "default",
        model: null,
        claudeSessionId: ID,
      }),
      inTeam: () => false,
      transcriptOf: () => null,
      historyRoots: [],
      dir,
      scan: () => [],
      now: () => 0,
      newId: () => "p1",
      timers: globalThis,
    });
    const base = {
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    };
    const server = startServer({ ...base, teleport: packages });
    const off = startServer(base);
    const client = new FrameClient(server.url);
    const bare = new FrameClient(off.url);
    cleanups.push(async () => {
      client.close();
      bare.close();
      await server.stop();
      await off.stop();
    });
    for (const c of [client, bare]) await c.request("hello", { token: TOKEN, client: "test" });
    const features = async (c: FrameClient) =>
      (await c.data<{ features?: string[] }>("host.info", {}))?.features ?? [];
    const why = (answer: { error?: unknown }) =>
      (answer.error as { reason?: string; params?: unknown } | undefined) ?? null;
    const prepared = why(await client.request("teleport.prepare", { sessionId: "s1" }));
    const read = why(
      await client.request("teleport.read", { id: "p9", part: "transcript", offset: 0 }),
    );
    const cancelled = (await client.request("teleport.cancel", { id: "p9" })).ok;
    const refused = why(await bare.request("teleport.prepare", { sessionId: "s1" }));
    expect([
      (await features(client)).includes("teleport"),
      (await features(bare)).includes("teleport"),
      prepared?.reason,
      read?.reason,
      cancelled,
      refused?.params,
    ]).toEqual([
      true,
      false,
      "teleport_no_transcript",
      "teleport_not_found",
      true,
      { feature: "teleport" },
    ]);
  });

  test("the server takes a package for this host in receive, write and abort; without it they are off", async () => {
    const { manager } = newManager();
    const inbox = new TeleportInbox({
      dir: tempDir("fd-teleport-in-"),
      now: () => 0,
      newId: () => "in-1",
      timers: globalThis,
    });
    await inbox.start();
    cleanups.push(() => inbox.stop());
    const base = {
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    };
    const server = startServer({ ...base, teleportInbox: inbox });
    const off = startServer(base);
    const client = new FrameClient(server.url);
    const bare = new FrameClient(off.url);
    cleanups.push(async () => {
      client.close();
      bare.close();
      await server.stop();
      await off.stop();
    });
    for (const c of [client, bare]) await c.request("hello", { token: TOKEN, client: "test" });
    const text = "hello";
    const manifest = {
      id: "p1",
      sessionId: "s1",
      claudeSessionId: ID,
      cwd: "/work/app",
      model: null,
      permissionMode: "default",
      persona: null,
      expiresAt: "2026-11-06T12:30:00.000Z",
      parts: [
        {
          name: "transcript",
          size: text.length,
          sha256: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
        },
      ],
      secrets: { lines: 0, labels: [] },
    };
    const received = await client.data<{ id: string }>("teleport.receive", { manifest });
    const written = await client.data<{ written: number }>("teleport.write", {
      id: "in-1",
      part: "transcript",
      offset: 0,
      data: Buffer.from(text).toString("base64"),
    });
    const whole = await inbox.received("in-1").then(
      () => "whole",
      (e: { reason?: string }) => e.reason,
    );
    const aborted = (await client.request("teleport.abort", { id: "in-1" })).ok;
    const refused = await bare.request("teleport.receive", { manifest });
    expect([
      received?.id,
      written?.written,
      whole,
      aborted,
      (refused.error as { params?: unknown } | undefined)?.params,
    ]).toEqual(["in-1", 5, "whole", true, { feature: "teleport" }]);
  });

  test("the import reads the inbox, the roots, the history and the sessions from the daemon", async () => {
    const { indexer, root } = await indexed();
    const resumed: unknown[] = [];
    const closed: string[] = [];
    const shown: unknown[] = [];
    const inbox = { received: async () => ({}) as never, claim: async () => ({}) as never };
    const allowedRoots = ["/work"];
    const deps = teleportImportDeps({
      inbox,
      allowedRoots,
      historyRoots: [root, "/second"],
      indexer,
      manager: {
        createResumed: async (opts) => {
          resumed.push(opts);
          return { sessionId: "t1" };
        },
        // #870: a record of another session, then two of this session's own.
        list: () => [
          { id: "other", claudeSessionId: "11111111-1111-4111-8111-111111111111", status: "idle" },
          { id: "old", claudeSessionId: ID, status: "idle" },
          { id: "older", claudeSessionId: ID, status: "ended" },
        ],
        close: async (sessionId) => {
          closed.push(sessionId);
        },
      },
      meta: {
        set: (claudeSessionId, patch) => {
          shown.push([claudeSessionId, patch]);
        },
      },
    }) as TeleportImportDeps;
    const opts = {
      cwd: "/work/app",
      claudeSessionId: ID,
      name: null,
      permissionMode: "default" as const,
    };
    expect([
      deps.inbox === inbox,
      deps.allowedRoots === allowedRoots,
      deps.historyRoot,
      (await deps.transcriptOf(ID)) !== null,
      await deps.transcriptOf("11111111-1111-4111-8111-111111111111"),
      await deps.resume(opts),
      resumed,
      deps.sessionsOf(ID),
      deps.sessionsOf("22222222-2222-4222-8222-222222222222"),
      await deps.close("old").then(() => closed),
      (deps.unarchive(ID), shown),
      deps.now() instanceof Date && Math.abs(deps.now().getTime() - Date.now()) < 60_000,
      teleportImportDeps({
        inbox,
        allowedRoots,
        historyRoots: [],
        indexer,
        manager: stubManager,
        meta: undefined,
      }),
    ]).toEqual([
      true,
      true,
      root,
      true,
      null,
      { sessionId: "t1" },
      [opts],
      [
        { id: "old", status: "idle" },
        { id: "older", status: "ended" },
      ],
      [],
      ["old"],
      [[ID, { archived: false }]],
      true,
      undefined,
    ]);
  });

  test("a transcript the indexer has not seen yet still counts: the history folders are read too (#715)", async () => {
    const first = projectsRoot();
    const second = projectsRoot();
    const file = writeTranscript(second, "-other-app", ID, [
      userLine({ uuid: "u1", text: "just created", cwd: "/other/app" }),
    ]);
    const unseen = { transcriptFile: () => null };
    const deps = teleportImportDeps({
      inbox: { received: async () => ({}) as never, claim: async () => ({}) as never },
      allowedRoots: [],
      historyRoots: [first, second],
      indexer: unseen,
      manager: stubManager,
      meta: undefined,
    }) as TeleportImportDeps;
    expect([
      await deps.transcriptOf(ID),
      await deps.transcriptOf("11111111-1111-4111-8111-111111111111"),
      await deps.transcriptOf("../escape"),
    ]).toEqual([file, null, null]);
  });

  test("the server finishes a teleport on this host; without it, finish is off", async () => {
    const { manager } = newManager();
    const inbox = new TeleportInbox({
      dir: tempDir("fd-teleport-in-"),
      now: () => 0,
      newId: () => "in-1",
      timers: globalThis,
    });
    await inbox.start();
    cleanups.push(() => inbox.stop());
    const base = {
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    };
    const server = startServer({
      ...base,
      teleportInbox: inbox,
      teleportImport: teleportImportDeps({
        inbox,
        allowedRoots: [],
        historyRoots: [tempDir("fd-history-")],
        indexer: undefined,
        manager,
        meta: undefined,
      }),
    });
    const off = startServer(base);
    const client = new FrameClient(server.url);
    const bare = new FrameClient(off.url);
    cleanups.push(async () => {
      client.close();
      bare.close();
      await server.stop();
      await off.stop();
    });
    for (const c of [client, bare]) await c.request("hello", { token: TOKEN, client: "test" });
    const why = (answer: { error?: unknown }) =>
      (answer.error as { reason?: string; params?: unknown } | undefined) ?? null;
    const finish = { id: "in-9", repo: "/work/app" };
    expect([
      why(await client.request("teleport.finish", finish))?.reason,
      why(await bare.request("teleport.finish", finish))?.params,
    ]).toEqual(["teleport_not_found", { feature: "teleport" }]);
  });
});
