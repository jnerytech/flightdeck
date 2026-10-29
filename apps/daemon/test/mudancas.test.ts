import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Changes, type ChangesOptions } from "../src/review/changes.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { cardWhen, git, gitRepo, newBoard } from "./board-helpers.ts";
import { newManager, poll, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { manualTime } from "./time-helpers.ts";
import { insertSession } from "./usage-helpers.ts";

// Real git in temp repositories: more than the default 5 s.
setDefaultTimeout(20_000);

const TOKEN = "changes-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

type Db = EventStore["db"];

/** A watcher the test fires by hand, and whether it was closed. */
function fakeWatch() {
  const watchers: Array<{ root: string; fire(name: string | null): void; closed: boolean }> = [];
  const watch: NonNullable<ChangesOptions["watch"]> = (root, onEvent) => {
    const w = { root, fire: onEvent, closed: false };
    watchers.push(w);
    return {
      close: () => {
        w.closed = true;
      },
    };
  };
  return { watch, watchers };
}

/** A repo with a commit, then a modified file, a new text file and a new binary file. */
function dirtyRepo() {
  const { root, repo } = gitRepo();
  writeFileSync(join(repo, "README.md"), "# repo\nmais\n");
  writeFileSync(join(repo, "novo.txt"), "um\ndois\n");
  writeFileSync(join(repo, "img.bin"), Buffer.from([0x89, 0x50, 0x00, 0x01]));
  return { root, repo };
}

const summary = (files: Array<Record<string, unknown>>) =>
  files.map((f) => [f.path, f.status, f.additions, f.deletions, f.binary, f.uncommitted]);

function insertExternal(db: Db, claudeSessionId: string, cwd: string) {
  db.query(
    `INSERT INTO external_sessions (claude_session_id, cwd, status, started_at, last_event_at)
     VALUES (?, ?, 'running', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
  ).run(claudeSessionId, cwd);
}

function insertHistory(db: Db, claudeSessionId: string, cwd: string) {
  db.query(
    `INSERT INTO history_sessions (claude_session_id, cwd, title, first_ts, last_ts, message_count, origin, file_path)
     VALUES (?, ?, 't', 'x', 'x', 1, 'external', 'f')`,
  ).run(claudeSessionId, cwd);
}

describe("mudancas", () => {
  test("sessão: diff do working tree contra HEAD, com não rastreados e o binário marcado sem diff", async () => {
    const { repo } = dirtyRepo();
    mkdirSync(join(repo, "src"));
    const db = new EventStore(":memory:").db;
    // The session ran in a subfolder: the diff is of the whole repository.
    insertSession(db, "m-1", "s-1", join(repo, "src"));
    const changes = new Changes({ db });
    const result = await changes.get("session:s-1");
    expect(result.root).toBe(repo);
    expect(result.base).toBeNull();
    expect(summary(result.files)).toEqual([
      ["README.md", "modified", 1, 0, false, true],
      ["img.bin", "added", 0, 0, true, true],
      ["novo.txt", "added", 2, 0, false, true],
    ]);
    expect(result.files[0]?.hunks).toEqual([
      {
        header: "@@ -1 +1,2 @@",
        lines: [
          { op: " ", text: "# repo" },
          { op: "+", text: "mais" },
        ],
      },
    ]);
    expect(result.files[1]?.hunks).toEqual([]);
  });

  test("sessões do terminal e do histórico também, mesmo fora de allowedRoots; repositório sem commit", async () => {
    const { repo } = dirtyRepo();
    const db = new EventStore(":memory:").db;
    insertExternal(db, "e-1", repo);
    insertHistory(db, "h-1", repo);
    const changes = new Changes({ db });
    expect((await changes.get("session:e-1")).files).toHaveLength(3);
    expect((await changes.get("session:h-1")).files).toHaveLength(3);
    const fresh = join(tempDir("fd-fresh-"), "vazio");
    mkdirSync(fresh);
    git(fresh, "init", "-q", "-b", "main");
    writeFileSync(join(fresh, "a.txt"), "a\n");
    writeFileSync(join(fresh, "b.txt"), "b\n");
    git(fresh, "add", "a.txt");
    insertHistory(db, "h-2", fresh);
    expect(summary((await changes.get("session:h-2")).files)).toEqual([
      ["a.txt", "added", 1, 0, false, true],
      ["b.txt", "added", 1, 0, false, true],
    ]);
  });

  test("alvo desconhecido, fora de um repositório git ou malformado é recusado", async () => {
    const db = new EventStore(":memory:").db;
    const plain = tempDir("fd-plain-");
    insertHistory(db, "h-1", plain);
    const changes = new Changes({ db });
    const code = (target: string) =>
      changes.get(target).then(
        () => "ok",
        (error: { code?: string }) => error.code ?? "sem código",
      );
    expect(await code("session:nada")).toBe("not_found");
    expect(await code("card:nada")).toBe("not_found");
    expect(await code("session:h-1")).toBe("invalid_state");
    expect(await code("pasta:/tmp")).toBe("bad_request");
  });

  test("card: diff contra a base, com o que foi commitado e o que não foi", async () => {
    const ctx = newBoard();
    cleanups.push(() => ctx.board.stop());
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const card = ctx.board.createCard(project.id, { title: "Mudar", description: "oi" });
    await ctx.board.startCard(card.id);
    const started = await cardWhen(ctx.board, card.id, (c) => c.worktreePath !== null);
    const worktree = started?.worktreePath ?? "";
    writeFileSync(join(worktree, "feito.txt"), "feito\n");
    git(worktree, "add", "feito.txt");
    git(worktree, "commit", "-q", "-m", "feito");
    writeFileSync(join(worktree, "README.md"), "# repo\npendente\n");
    const changes = new Changes({ db: ctx.store.db, board: ctx.board });
    const result = await changes.get(`card:${card.id}`);
    expect([result.root, result.base]).toEqual([worktree, "main"]);
    expect(summary(result.files)).toEqual([
      ["feito.txt", "added", 1, 0, false, false],
      ["README.md", "modified", 1, 0, false, true],
    ]);
  });

  test("watcher com debounce de 500 ms; mudanças em .git e .flightdeck não contam", async () => {
    const { repo } = dirtyRepo();
    const db = new EventStore(":memory:").db;
    insertHistory(db, "h-1", repo);
    const time = manualTime();
    const fake = fakeWatch();
    const changes = new Changes({ db, watch: fake.watch, timers: time.timers });
    const updates: number[] = [];
    const stop = await changes.watch("session:h-1", (result) => updates.push(result.files.length));
    const watcher = fake.watchers[0];
    expect(watcher?.root).toBe(repo);
    watcher?.fire(".git/index");
    watcher?.fire(".git\\index.lock");
    watcher?.fire(".flightdeck/worktrees/x/a.txt");
    time.advance(600);
    await Bun.sleep(50);
    expect(updates).toEqual([]);
    watcher?.fire("README.md");
    time.advance(300);
    watcher?.fire("novo.txt");
    time.advance(199);
    await Bun.sleep(50);
    expect(updates).toEqual([]);
    time.advance(1);
    await poll(() => updates.length > 0);
    expect(updates).toEqual([3]);
    // An event without a name counts as a change.
    watcher?.fire(null);
    time.advance(500);
    await poll(() => updates.length > 1);
    expect(updates).toEqual([3, 3]);
    stop();
    expect(watcher?.closed).toBe(true);
  });

  test("changes.get, changes.watch e changes.unwatch pelo protocolo; fechar a conexão para o watcher", async () => {
    const { repo } = dirtyRepo();
    const { manager, root, store } = newManager();
    insertHistory(store.db, "h-1", repo);
    const time = manualTime();
    const fake = fakeWatch();
    const changes = new Changes({ db: store.db, watch: fake.watch, timers: time.timers });
    const server = startServer({
      manager,
      changes,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    // The app shows the Mudanças tab for hosts that announce it.
    expect((await client.data<{ features: string[] }>("host.info", {}))?.features).toEqual([
      "review",
    ]);
    const got = await client.data<{ files: unknown[] }>("changes.get", { target: "session:h-1" });
    expect(got?.files.length ?? 0).toBe(3);
    expect(await client.data("changes.watch", { target: "session:h-1" })).toBeUndefined();
    fake.watchers[0]?.fire("README.md");
    time.advance(500);
    const updated = () => client.frames.filter((f) => f.type === "changes.updated");
    await poll(() => updated().length > 0);
    expect(updated()[0]?.target).toBe("session:h-1");
    expect(await client.data("changes.unwatch", { target: "session:h-1" })).toBeUndefined();
    expect(fake.watchers[0]?.closed).toBe(true);
    await client.request("changes.watch", { target: "session:h-1" });
    client.close();
    await poll(() => fake.watchers[1]?.closed === true);
    expect(fake.watchers[1]?.closed).toBe(true);
  });

  test("sem watcher injetado, o fs.watch do cwd e o timer real avisam a mudança", async () => {
    const { repo } = dirtyRepo();
    const db = new EventStore(":memory:").db;
    insertHistory(db, "h-1", repo);
    const updates: number[] = [];
    const stop = await new Changes({ db, debounceMs: 20 }).watch("session:h-1", (r) =>
      updates.push(r.files.length),
    );
    cleanups.push(stop);
    await Bun.sleep(100);
    writeFileSync(join(repo, "outro.txt"), "x");
    await poll(() => updates.includes(4), 5000);
    expect(updates).toContain(4);
    // Stopping with a diff pending: the real timer is cancelled too.
    const before = updates.length;
    writeFileSync(join(repo, "mais.txt"), "x");
    await poll(() => false, 10);
    stop();
    await Bun.sleep(200);
    expect(updates.length).toBe(before);
  });

  test("pasta que sumiu não é repositório; parar cancela o diff pendente; falha depois de um evento vai para o log", async () => {
    const { repo } = dirtyRepo();
    const db = new EventStore(":memory:").db;
    insertHistory(db, "h-gone", join(repo, "nao-existe"));
    insertHistory(db, "h-1", repo);
    const time = manualTime();
    const fake = fakeWatch();
    const logs: string[] = [];
    const changes = new Changes({
      db,
      watch: fake.watch,
      timers: time.timers,
      log: (m) => logs.push(m),
    });
    const code = await changes.get("session:h-gone").then(
      () => "ok",
      (error: { code?: string }) => error.code ?? "sem código",
    );
    expect(code).toBe("invalid_state");
    const updates: unknown[] = [];
    const stop = await changes.watch("session:h-1", (r) => updates.push(r));
    fake.watchers[0]?.fire("README.md");
    stop();
    time.advance(500);
    await Bun.sleep(50);
    expect(updates).toEqual([]);
    // The repository goes away between the event and the diff.
    await changes.watch("session:h-1", (r) => updates.push(r));
    fake.watchers[1]?.fire("README.md");
    db.query("UPDATE history_sessions SET cwd = ? WHERE claude_session_id = 'h-1'").run(
      join(repo, "nao-existe"),
    );
    time.advance(500);
    await poll(() => logs.length > 0);
    expect(updates).toEqual([]);
    expect(logs[0] ?? "").toContain("mudanças: diff de session:h-1 falhou");
  });
});
