import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git as run } from "../../src/git/adapters/git.ts";
import { FolderLocks } from "../../src/worktrees/domain/locks.ts";
import { createWorktrees } from "../../src/worktrees/wiring.ts";
import { Worktrees } from "../../src/worktrees/worktrees.ts";
import { git, gitRepo, newBoard } from "../support/board-helpers.ts";
import { newManager } from "../support/helpers.ts";
import { blockersOf, ID, setup } from "../support/worktree-security.ts";

describe("worktrees-seguranca: files git does not show are not lost (F5)", () => {
  function withIgnore() {
    const where = gitRepo();
    writeFileSync(join(where.repo, ".gitignore"), "node_modules/\nnotes.local\n.env\n");
    git(where.repo, "add", ".gitignore");
    git(where.repo, ...ID, "commit", "-q", "-m", "ignore");
    return where;
  }

  test("an untracked file counts even when git is set not to show untracked files", async () => {
    const where = gitRepo();
    git(where.repo, "config", "status.showUntrackedFiles", "no");
    const s = setup({}, where);
    const path = s.add("x");
    writeFileSync(join(path, "scratch.txt"), "x");
    expect((await blockersOf(s))["fd/x"]).toContain("dirty");
    const result = await s.worktrees.remove([{ projectId: "p1", path }]);
    expect(result.removed).toEqual([]);
    expect(existsSync(join(path, "scratch.txt"))).toBe(true);
  });

  test("an ignored file that is not rebuildable keeps the worktree; node_modules does not", async () => {
    const where = withIgnore();
    const s = setup({}, where);
    const mods = s.add("mods");
    mkdirSync(join(mods, "node_modules"));
    writeFileSync(join(mods, "node_modules", "x.js"), "x");
    const notes = s.add("notes");
    writeFileSync(join(notes, "notes.local"), "my notes");
    const env = s.add("env");
    writeFileSync(join(env, ".env"), "KEY=1");
    const by = await blockersOf(s);
    expect(by["fd/mods"]).toEqual([]);
    expect(by["fd/notes"]).toEqual(["ignored_files"]);
    expect(by["fd/env"]).toEqual(["ignored_files"]);
    const result = await s.worktrees.remove([{ projectId: "p1", path: notes }]);
    expect(result.removed).toEqual([]);
    expect(existsSync(join(notes, "notes.local"))).toBe(true);
  });

  test("Flightdeck's own ignored settings.local.json is no loss, though the file is a credential for reads (#806)", async () => {
    const where = gitRepo();
    writeFileSync(join(where.repo, ".gitignore"), ".claude/settings.local.json\n");
    git(where.repo, "add", ".gitignore");
    git(where.repo, ...ID, "commit", "-q", "-m", "ignore settings");
    const s = setup({}, where);
    const own = s.add("own");
    mkdirSync(join(own, ".claude"));
    writeFileSync(join(own, ".claude", "settings.local.json"), "{}\n");
    expect((await blockersOf(s))["fd/own"]).toEqual([]);
  });

  test("the removal asks git to look at untracked files whatever the config says", async () => {
    const calls: string[][] = [];
    const s = setup({
      git: (cwd, ...args) => {
        calls.push(args);
        return run(cwd, ...args);
      },
    });
    const path = s.add("x");
    await s.worktrees.remove([{ projectId: "p1", path }]);
    const removal = calls.find((a) => a.includes("remove"));
    expect(removal?.slice(0, 2)).toEqual(["-c", "status.showUntrackedFiles=all"]);
    expect(calls.find((a) => a.includes("status"))).toContain("--untracked-files=all");
  });
});

describe("worktrees-seguranca: the card keeps a truthful record (F6)", () => {
  test("releasing frees only the worktree that was removed, and drops the branch that is gone", async () => {
    const ctx = newBoard();
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const card = ctx.board.createCard(project.id, { title: "One", description: "" });
    ctx.store.db
      .query("UPDATE cards SET worktree_path = '/a', branch = 'fd/a' WHERE id = ?")
      .run(card.id);
    ctx.board.releaseWorktree(card.id, "/b", true);
    expect(ctx.board.getCard(card.id)).toMatchObject({ worktreePath: "/a", branch: "fd/a" });
    ctx.board.releaseWorktree(card.id, "/a", false);
    expect(ctx.board.getCard(card.id)).toMatchObject({ worktreePath: null, branch: "fd/a" });
    ctx.store.db.query("UPDATE cards SET worktree_path = '/a' WHERE id = ?").run(card.id);
    ctx.board.releaseWorktree(card.id, "/a", true);
    expect(ctx.board.getCard(card.id)).toMatchObject({ worktreePath: null, branch: null });
  });

  test("a card whose worktree the panel removed can still be discarded", async () => {
    const ctx = newBoard();
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const card = ctx.board.createCard(project.id, { title: "One", description: "" });
    ctx.store.db
      .query("UPDATE cards SET worktree_path = '/a', branch = 'fd/gone' WHERE id = ?")
      .run(card.id);
    ctx.board.releaseWorktree(card.id, "/a", true);
    const last = await ctx.board.discardCard(card.id, true);
    expect(last).toMatchObject({ id: card.id, discarded: true });
    ctx.board.stop();
  });

  test("a card in a run is active, an idle one is not", async () => {
    const ctx = newBoard();
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const card = ctx.board.createCard(project.id, { title: "One", description: "" });
    expect(ctx.board.isActive(card.id)).toBe(false);
    await ctx.board.startCard(card.id);
    expect(ctx.board.isActive(card.id)).toBe(true);
    ctx.board.stop();
  });
});

describe("worktrees-seguranca: what git hides is not deleted (re-review N1)", () => {
  for (const flag of ["--skip-worktree", "--assume-unchanged"]) {
    test(`an edit hidden with ${flag} keeps the worktree and survives the removal`, async () => {
      const where = gitRepo();
      writeFileSync(join(where.repo, "t.txt"), "committed\n");
      git(where.repo, "add", "t.txt");
      git(where.repo, ...ID, "commit", "-q", "-m", "t");
      const s = setup({}, where);
      const path = s.add("hidden");
      writeFileSync(join(path, "t.txt"), "my edit, hidden from status\n");
      git(path, "update-index", flag, "t.txt");
      // git itself says the folder is clean: that is the trap.
      expect(git(path, "status", "--porcelain").trim()).toBe("");
      expect((await blockersOf(s))["fd/hidden"]).toEqual(["hidden_changes"]);
      const result = await s.worktrees.remove([{ projectId: "p1", path }]);
      expect(result.removed).toEqual([]);
      expect(result.kept[0]?.reason).toBe("hidden_changes");
      expect(readFileSync(join(path, "t.txt"), "utf8")).toBe("my edit, hidden from status\n");
    });
  }

  test("a failing ls-files is a blocker too: when git cannot say, nothing goes", async () => {
    const failing = (cwd: string, ...args: string[]) =>
      args.includes("ls-files")
        ? Promise.resolve({ code: 128, stdout: "", stderr: "fatal" })
        : run(cwd, ...args);
    const s = setup({ git: failing });
    s.add("x");
    expect((await blockersOf(s))["fd/x"]).toContain("unknown_state");
  });
});

describe("worktrees-seguranca: only what a build recreates, at the root, goes unasked (re-review N2)", () => {
  const ignoring = (extra = "") => {
    const where = gitRepo();
    writeFileSync(
      join(where.repo, ".gitignore"),
      `node_modules/\nout\nbuild/\n.cache/\nnotes.local\n.env\n*.pem\ncredentials.json\nlocal.json\n${extra}`,
    );
    git(where.repo, "add", ".gitignore");
    git(where.repo, ...ID, "commit", "-q", "-m", "ignore");
    return where;
  };
  const put = (dir: string, rel: string, text = "x") => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };

  test("a rebuildable folder at the root goes: node_modules, dist, build, target, coverage, .cache, .next, out", async () => {
    const where = ignoring();
    const s = setup({}, where);
    const path = s.add("root");
    for (const dir of ["node_modules", "build", "out", ".cache"]) put(path, `${dir}/x.bin`);
    expect((await blockersOf(s))["fd/root"]).toEqual([]);
  });

  test("the same names below the root are somebody's data and keep the worktree", async () => {
    const where = ignoring();
    const s = setup({}, where);
    for (const rel of [
      "data/out/results.db",
      "docs/build/draft.md",
      "sub/.cache/credentials.txt",
    ]) {
      const name = rel.replaceAll("/", "-").replaceAll(".", "_");
      const path = s.add(name);
      put(path, rel);
      expect((await blockersOf(s))[`fd/${name}`]).toEqual(["ignored_files"]);
      const result = await s.worktrees.remove([{ projectId: "p1", path }]);
      expect(result.removed).toEqual([]);
      expect(existsSync(join(path, rel))).toBe(true);
    }
  });

  test("a file that is not a folder named like a rebuildable one is not one", async () => {
    const where = ignoring();
    const s = setup({}, where);
    const path = s.add("file");
    put(path, "out", "a file called out");
    expect((await blockersOf(s))["fd/file"]).toEqual(["ignored_files"]);
  });

  test("a credential-looking name always blocks, even next to the root or identical to the project's copy", async () => {
    const where = ignoring();
    const s = setup({}, where);
    const names = [".env", "server.pem", "credentials.json"];
    for (const name of names) {
      put(where.repo, name, "same in both");
      const tag = name.replaceAll(".", "_");
      const path = s.add(tag);
      put(path, name, "same in both");
      expect((await blockersOf(s))[`fd/${tag}`]).toEqual(["ignored_files"]);
    }
  });

  test("the secret names the classifier knows block too: a cloud config, a database password, a key store, a history (issue #449)", async () => {
    const names = [
      ".boto",
      ".s3cfg",
      ".pgpass",
      "wallet.dat",
      ".psql_history",
      "key.ppk",
      "a.tfstate",
    ];
    const where = ignoring(`${names.join("\n")}\n`);
    const s = setup({}, where);
    for (const name of names) {
      const tag = name.replaceAll(/[./]/g, "_");
      // The same bytes in the project: only a credential-looking name still blocks.
      put(where.repo, name, "same in both");
      const path = s.add(tag);
      put(path, name, "same in both");
      expect((await blockersOf(s))[`fd/${tag}`], `${name} blocks`).toEqual(["ignored_files"]);
    }
  });

  test("an ignored file that is a copy of the project's own is not a loss; an edited copy is", async () => {
    const where = ignoring();
    put(where.repo, "local.json", '{"a":1}');
    const s = setup({}, where);
    const same = s.add("same");
    put(same, "local.json", '{"a":1}');
    const edited = s.add("edited");
    put(edited, "local.json", '{"a":2}');
    const by = await blockersOf(s);
    expect(by["fd/same"]).toEqual([]);
    expect(by["fd/edited"]).toEqual(["ignored_files"]);
  });

  test("the confirmation says that rebuildable files go with the folder", async () => {
    // The dictionary is en.ts plus the domain files of en/ as it is split (#1598).
    const dir = join(import.meta.dir, "../../../desktop/src/i18n");
    const files = [join(dir, "en.ts")];
    if (existsSync(join(dir, "en"))) {
      const names = readdirSync(join(dir, "en")).filter((name) => name.endsWith(".ts"));
      files.push(...names.map((name) => join(dir, "en", name)));
    }
    // One file must say it, never a match across two files.
    const says = files.some((file) =>
      /confirm:[\s\S]{0,300}rebuil/.test(readFileSync(file, "utf8")),
    );
    expect(says).toBe(true);
  });
});

describe("worktrees-seguranca: the rest of the re-review (N3, N5, N6, N7)", () => {
  test("a session of any live state holds the folder, an ended or failed one does not (N5)", async () => {
    for (const [status, blocked] of [
      ["running", true],
      ["idle", true],
      ["starting", true],
      ["awaiting_permission", true],
      ["ended", false],
      ["error", false],
    ] as const) {
      const ctx = newBoard();
      const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
      const path = join(ctx.repo, ".flightdeck", "worktrees", "one");
      git(ctx.repo, "worktree", "add", "-q", "-b", "fd/one", path, "main");
      const card = ctx.board.createCard(project.id, { title: "One", description: "" });
      ctx.store.db.query("UPDATE cards SET worktree_path = ? WHERE id = ?").run(path, card.id);
      const w = createWorktrees({
        board: ctx.board,
        sessions: { list: () => [{ cwd: path, status }] },
        runs: { state: () => ({ status: "idle" }) },
        terminals: { list: () => [] },
        externals: { list: () => [] },
        locks: new FolderLocks(),
      });
      const found = (await w.list()).worktrees.find((i) => i.path === path)?.blockers;
      expect([status, found]).toEqual([status, blocked ? ["live_session"] : []]);
    }
  });

  test("a card waiting for a slot is active (N5)", async () => {
    const ctx = newBoard();
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const card = ctx.board.createCard(project.id, { title: "One", description: "" });
    expect(ctx.board.isActive(card.id)).toBe(false);
    ctx.store.db
      .query("INSERT INTO card_runs (id, card_id, queued_at) VALUES ('r1', ?, ?)")
      .run(card.id, new Date().toISOString());
    expect(ctx.board.getCard(card.id).queued).toBe(true);
    expect(ctx.board.isActive(card.id)).toBe(true);
  });

  test("an ended session cannot be resumed, and a transcript cannot be taken over, in a folder being removed (N3, N5)", async () => {
    const locks = new FolderLocks();
    const { manager, project } = newManager({ folderLocks: locks });
    const { sessionId } = await manager.create({ cwd: project, prompt: "hi" });
    await manager.close(sessionId);
    locks.hold(project);
    expect(() => manager.resume(sessionId)).toThrow(/being removed/);
    await expect(
      manager.createResumed({ cwd: project, claudeSessionId: "c1", name: null }),
    ).rejects.toMatchObject({ reason: "folder_removing" });
    locks.release(project);
    await manager.resume(sessionId);
  });

  test("a second removal of the folder being removed is refused as in use, not left to chance (N5)", async () => {
    const s = setup();
    const path = s.add("twice");
    const [a, b] = await Promise.all([
      s.worktrees.remove([{ projectId: "p1", path }]),
      s.worktrees.remove([{ projectId: "p1", path }]),
    ]);
    const kept = [...a.kept, ...b.kept];
    expect(a.removed.length + b.removed.length).toBe(1);
    expect(kept).toEqual([{ path, reason: "running" }]);
  });

  test("a branch tip that cannot be read is a blocker, and the card keeps its branch only when the ref stayed (N5)", async () => {
    const tipFails = (cwd: string, ...args: string[]) =>
      args.some((a) => a.startsWith("refs/heads/fd/") && a.endsWith("^{commit}"))
        ? Promise.resolve({ code: 1, stdout: "", stderr: "" })
        : run(cwd, ...args);
    const s = setup({ git: tipFails });
    s.add("x");
    expect((await blockersOf(s))["fd/x"]).toContain("unknown_state");
    const cleared: boolean[] = [];
    const ok = setup({ detach: (_id, _path, clearBranch) => void cleared.push(clearBranch) });
    const path = ok.add("clean");
    const w = new Worktrees({
      ...ok.options,
      cards: () => [
        {
          id: "c1",
          title: "t",
          column: "done",
          worktreePath: path,
          updatedAt: "2026-01-01",
          prState: null,
        },
      ],
    });
    await w.remove([{ projectId: "p1", path }]);
    expect(cleared).toEqual([true]);
  });

  test("the remove has its own, longer deadline than the other git commands (N6)", async () => {
    const { gitDeadlineFor } = await import("../../src/worktrees/wiring.ts");
    expect(gitDeadlineFor(["status"], 60_000)).toBe(60_000);
    expect(gitDeadlineFor(["-c", "x=y", "worktree", "remove", "/p"], 60_000)).toBeGreaterThan(
      5 * 60_000,
    );
  });

  test("the commits are counted on the branch tip that was read, not on HEAD (N7)", async () => {
    const calls: string[][] = [];
    const s = setup({
      git: (cwd, ...args) => {
        calls.push(args);
        return run(cwd, ...args);
      },
    });
    s.add("x");
    await s.worktrees.list();
    const count = calls.find((a) => a.includes("rev-list"));
    expect(count).toBeDefined();
    expect(count).not.toContain("HEAD");
    expect(count?.some((a) => /^[0-9a-f]{40,64}$/.test(a))).toBe(true);
  });
});
