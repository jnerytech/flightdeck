import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Rewinder } from "../src/checkpoints/rewind.ts";
import { Snapshots } from "../src/checkpoints/snapshots.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { git, gitRepo } from "./board-helpers.ts";
import { newManager, poll } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "rewind-token-0123456789abcdef";
const read = (path: string) => readFileSync(path, "utf8");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A repo where turn 1 edits README, deletes .gitignore's neighbour and creates a file. */
async function turnInRepo(sessions = { busy: () => false, rewindFiles: async () => null }) {
  const store = new EventStore(":memory:");
  cleanups.push(() => store.close());
  const snapshots = new Snapshots({ db: store.db });
  const { repo } = gitRepo();
  writeFileSync(join(repo, "apagar.txt"), "vai sumir\n");
  git(repo, "add", "apagar.txt");
  git(repo, "commit", "-q", "-m", "apagar");
  mkdirSync(join(repo, "node_modules"));
  writeFileSync(join(repo, "node_modules", "lixo.js"), "ignorado\n");
  const before = await snapshots.take({ cwd: repo, claudeSessionId: "s1", kind: "before" });
  writeFileSync(join(repo, "README.md"), "# repo\nlinha nova\n");
  writeFileSync(join(repo, "novo.txt"), "criado no turno\n");
  rmSync(join(repo, "apagar.txt"));
  await snapshots.take({ cwd: repo, claudeSessionId: "s1", kind: "after" });
  const turn = "row" in before ? before.row.n : -1;
  return { store, snapshots, repo, turn, rewinder: new Rewinder({ snapshots, sessions }) };
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).message;
  }
}

describe("rewind", () => {
  test("prévia pelo snapshot: arquivos que mudam, inserções e remoções, sem tocar em nada", async () => {
    const { rewinder, repo, turn } = await turnInRepo();
    const preview = await rewinder.preview("s1", turn);
    expect(preview).toEqual({
      via: "snapshot",
      files: [
        { path: "README.md", change: "modified" },
        { path: "apagar.txt", change: "deleted" },
        { path: "novo.txt", change: "created" },
      ],
      insertions: 2,
      deletions: 1,
    });
    expect(existsSync(join(repo, "novo.txt"))).toBe(true);
  });

  test("aplicar pelo snapshot restaura, remove o criado depois, guarda o snapshot de segurança, e desfazer volta", async () => {
    const { rewinder, repo, turn, snapshots } = await turnInRepo();
    expect(await code(rewinder.apply("s1", turn, false))).toBe("invalid_state");
    expect(existsSync(join(repo, "novo.txt"))).toBe(true);
    const applied = await rewinder.apply("s1", turn, true);
    expect(applied.via).toBe("snapshot");
    expect(read(join(repo, "README.md"))).toBe("# repo\n");
    expect(read(join(repo, "apagar.txt"))).toBe("vai sumir\n");
    expect(existsSync(join(repo, "novo.txt"))).toBe(false);
    // Ignored files are never touched.
    expect(read(join(repo, "node_modules", "lixo.js"))).toBe("ignorado\n");
    expect(snapshots.list("s1").at(-1)?.kind).toBe("safety");
    expect(await code(rewinder.undo("s1", false))).toBe("invalid_state");
    await rewinder.undo("s1", true);
    expect(read(join(repo, "README.md"))).toBe("# repo\nlinha nova\n");
    expect(read(join(repo, "novo.txt"))).toBe("criado no turno\n");
    expect(existsSync(join(repo, "apagar.txt"))).toBe(false);
  });

  test("recusa com turno em andamento, turno desconhecido e desfazer sem volta anterior", async () => {
    const busy = await turnInRepo({ busy: () => true, rewindFiles: async () => null });
    expect(await code(busy.rewinder.apply("s1", busy.turn, true))).toBe("invalid_state");
    const { rewinder } = await turnInRepo();
    expect(await code(rewinder.preview("s1", 99))).toBe("not_found");
    expect(await code(rewinder.undo("s1", true))).toBe("not_found");
  });

  test("sessão gerenciada viva: usa o rewindFiles do SDK (prévia e real); sem poder, cai no snapshot", async () => {
    const calls: Array<{ id: string; dryRun: boolean }> = [];
    let canRewind = true;
    const runtime = new FakeRuntime({
      delayMs: 1,
      rewind: (id, dryRun) => {
        calls.push({ id, dryRun });
        return canRewind
          ? { canRewind: true, filesChanged: ["README.md"], insertions: 0, deletions: 1 }
          : { canRewind: false, error: "sem checkpoint" };
      },
    });
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    const { repo } = gitRepo();
    const { manager } = newManager({ store, runtime, allowedRoots: [dirname(repo)] });
    const { sessionId } = manager.create({ cwd: repo, prompt: "oi" });
    await poll(() => manager.get(sessionId).status === "idle", 3000);
    const claude = manager.get(sessionId).claudeSessionId as string;
    const snapshots = new Snapshots({ db: store.db });
    const before = await snapshots.take({
      cwd: repo,
      claudeSessionId: claude,
      kind: "before",
      turnUuid: "uuid-turno-1",
    });
    const turn = "row" in before ? before.row.n : -1;
    const rewinder = new Rewinder({ snapshots, sessions: manager });
    expect(await rewinder.preview(claude, turn)).toEqual({
      via: "sdk",
      files: [{ path: "README.md", change: "modified" }],
      insertions: 0,
      deletions: 1,
    });
    expect((await rewinder.apply(claude, turn, true)).via).toBe("sdk");
    expect(calls).toEqual([
      { id: "uuid-turno-1", dryRun: true },
      { id: "uuid-turno-1", dryRun: false },
    ]);
    canRewind = false;
    expect((await rewinder.preview(claude, turn)).via).toBe("snapshot");
  });

  test("cada turno gerenciado leva um uuid novo, que vai junto do snapshot antes", async () => {
    const edges: Array<{ kind: string; turnUuid?: string }> = [];
    const { manager, project } = newManager({
      onTurnEdge: (edge) => edges.push({ kind: edge.kind, turnUuid: edge.turnUuid }),
    });
    const { sessionId } = manager.create({ cwd: project, prompt: "um" });
    await poll(() => manager.get(sessionId).status === "idle", 3000);
    manager.send(sessionId, "dois");
    await poll(() => edges.length === 4, 3000);
    const uuids = edges.filter((e) => e.kind === "before").map((e) => e.turnUuid);
    expect(uuids).toHaveLength(2);
    expect(uuids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(uuids[0]).not.toBe(uuids[1]);
    expect(edges.filter((e) => e.kind === "after").map((e) => e.turnUuid)).toEqual([
      undefined,
      undefined,
    ]);
  });

  test("protocolo: rewind.preview, rewind.apply (com confirm) e rewind.undo", async () => {
    const { rewinder, repo, turn, snapshots } = await turnInRepo();
    const { manager } = newManager();
    const server = startServer({
      manager,
      snapshots,
      rewinder,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const preview = await client.data<{ via: string }>("rewind.preview", {
      claudeSessionId: "s1",
      turn,
    });
    expect(preview?.via).toBe("snapshot");
    expect(await client.request("rewind.apply", { claudeSessionId: "s1", turn })).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
    await client.data("rewind.apply", { claudeSessionId: "s1", turn, confirm: true });
    expect(existsSync(join(repo, "novo.txt"))).toBe(false);
    await client.data("rewind.undo", { claudeSessionId: "s1", confirm: true });
    expect(existsSync(join(repo, "novo.txt"))).toBe(true);
  });
});
