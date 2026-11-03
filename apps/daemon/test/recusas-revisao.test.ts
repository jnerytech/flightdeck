import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FlightdeckError } from "../src/errors.ts";
import { ProjectMemory } from "../src/memory/memory.ts";
import { inspectPlugin } from "../src/plugins/inventory.ts";
import { Changes } from "../src/review/changes.ts";
import { ReviewComments } from "../src/review/comments.ts";
import { ReviewFiles } from "../src/review/files.ts";
import { fileInRoot } from "../src/review/paths.ts";
import { RUN_CONFIG_PATH, RunConfigs } from "../src/runenv/config.ts";
import { RunManager } from "../src/runenv/manager.ts";
import { CardPorts } from "../src/runenv/ports.ts";
import { EventStore } from "../src/store/event-store.ts";
import { git, gitRepo, newBoard } from "./board-helpers.ts";
import { newManager, tempDir } from "./helpers.ts";
import { fakeRunHost, runConfig } from "./run-helpers.ts";
import { insertSession } from "./usage-helpers.ts";

// Real git in temporary repositories: more than the default 5 s.
setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** The code, reason and params of the refusal a call ends in; the detail is English, for logs. */
async function refused(call: () => unknown) {
  try {
    await call();
  } catch (error) {
    expect(error).toBeInstanceOf(FlightdeckError);
    const { code, reason, params, message } = error as FlightdeckError;
    expect(message).not.toMatch(/[ãõçáéíóú]/);
    return { code, reason, params };
  }
  throw new Error("it did not refuse");
}

/** A repository in the allowed root with a session `s-1` on it and `a.txt` committed. */
function reviewSetup() {
  const ctx = newManager();
  const repo = ctx.project;
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "a.txt"), "one\ntwo\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "first");
  insertSession(ctx.store.db, "m-1", "s-1", repo);
  const changes = new Changes({ db: ctx.store.db });
  const files = new ReviewFiles({
    changes,
    dataDir: tempDir("fd-data-"),
    allowedRoots: [ctx.root],
    now: () => Date.UTC(2026, 9, 1, 12),
  });
  const review = new ReviewComments({
    db: ctx.store.db,
    changes,
    manager: {} as never,
    now: () => Date.UTC(2026, 9, 1, 12),
  });
  return { ...ctx, repo, changes, files, review };
}

describe("recusas-revisao: the review resolves its target and says why it cannot", () => {
  test("a path outside the repository", async () => {
    for (const path of ["/etc/passwd", "../x", ".git/config", ""]) {
      const got = await refused(() => fileInRoot("/repo", path));
      expect(got).toMatchObject({ code: "bad_request", reason: "review_path_outside" });
      expect(got.params).toEqual({ path });
    }
  });

  test("a target that is not a session or a card, a card that is gone or has no worktree", async () => {
    const { changes } = reviewSetup();
    expect(await refused(() => changes.resolve("nonsense"))).toMatchObject({
      code: "bad_request",
      reason: "review_target_invalid",
      params: { target: "nonsense" },
    });
    expect(await refused(() => changes.resolve("card:c-9"))).toMatchObject({
      code: "not_found",
      reason: "card_not_found",
      params: { id: "c-9" },
    });
    const withBoard = new Changes({
      db: new EventStore(":memory:").db,
      board: { getCard: () => ({ worktreePath: null }) } as never,
    });
    expect(await refused(() => withBoard.resolve("card:c-1"))).toMatchObject({
      code: "invalid_state",
      reason: "card_no_worktree",
    });
  });

  test("a session that is gone, or whose folder is not a repository", async () => {
    const { changes, store } = reviewSetup();
    expect(await refused(() => changes.resolve("session:nope"))).toMatchObject({
      code: "not_found",
      reason: "session_not_found",
      params: { id: "nope" },
    });
    const plain = tempDir("fd-plain-");
    insertSession(store.db, "m-2", "s-2", plain);
    expect(await refused(() => changes.resolve("session:s-2"))).toMatchObject({
      code: "invalid_state",
      reason: "repo_not_git",
      params: { path: plain },
    });
  });
});

describe("recusas-revisao: the review's files say why they refuse", () => {
  test("reading: a file that is gone, too big, or not text", async () => {
    const { files, repo } = reviewSetup();
    writeFileSync(join(repo, "big.txt"), "x".repeat(1024 * 1024 + 1));
    writeFileSync(join(repo, "bin.dat"), Buffer.from([1, 0, 2]));
    expect(await refused(() => files.read("session:s-1", "gone.txt"))).toMatchObject({
      code: "not_found",
      reason: "review_file_missing",
      params: { path: "gone.txt" },
    });
    expect(await refused(() => files.read("session:s-1", "big.txt"))).toMatchObject({
      code: "bad_request",
      reason: "review_file_big",
      params: { path: "big.txt" },
    });
    expect(await refused(() => files.read("session:s-1", "bin.dat"))).toMatchObject({
      code: "bad_request",
      reason: "review_file_binary",
      params: { path: "bin.dat" },
    });
  });

  test("writing: a text that is too big, a file that changed, a link that leads out", async () => {
    const { files, repo } = reviewSetup();
    expect(
      await refused(() => files.write("session:s-1", "a.txt", "x".repeat(1024 * 1024 + 1), "h")),
    ).toMatchObject({ code: "bad_request", reason: "review_text_big" });
    expect(await refused(() => files.write("session:s-1", "a.txt", "new", "stale"))).toMatchObject({
      code: "file_conflict",
      reason: "review_file_changed",
      params: { path: "a.txt" },
    });
    symlinkSync(tmpOutside(), join(repo, "out.txt"));
    expect(await refused(() => files.write("session:s-1", "out.txt", "x", "h"))).toMatchObject({
      code: "forbidden_cwd",
      reason: "review_path_link",
      params: { path: "out.txt" },
    });
  });

  test("revert and undo: they ask for the confirmation, and undo needs a revert to undo", async () => {
    const { files } = reviewSetup();
    expect(await refused(() => files.revert("session:s-1", "a.txt", false))).toMatchObject({
      code: "invalid_state",
      reason: "review_revert_confirm",
    });
    expect(await refused(() => files.undoRevert("session:s-1", "a.txt", false))).toMatchObject({
      code: "invalid_state",
      reason: "review_undo_confirm",
    });
    expect(await refused(() => files.undoRevert("session:s-1", "a.txt", true))).toMatchObject({
      code: "invalid_state",
      reason: "review_undo_nothing",
      params: { path: "a.txt" },
    });
  });
});

/** A file outside every allowed root for a link to point at. */
function tmpOutside(): string {
  const dir = tempDir("fd-outside-");
  const file = join(dir, "secret.txt");
  writeFileSync(file, "s");
  return file;
}

describe("recusas-revisao: the review comments say why they refuse", () => {
  const input = (over: Record<string, unknown> = {}) => ({
    target: "session:s-1",
    path: "a.txt",
    side: "new" as const,
    lineStart: 1,
    lineEnd: 1,
    body: "fix this",
    ...over,
  });

  test("a comment with no text, on a file or lines that are not there", async () => {
    const { review } = reviewSetup();
    expect(await refused(() => review.add(input({ body: "  " })))).toMatchObject({
      code: "bad_request",
      reason: "review_comment_empty",
    });
    expect(await refused(() => review.add(input({ path: "gone.txt" })))).toMatchObject({
      code: "bad_request",
      reason: "review_side_missing",
      params: { path: "gone.txt" },
    });
    expect(await refused(() => review.add(input({ lineStart: 2, lineEnd: 9 })))).toMatchObject({
      code: "bad_request",
      reason: "review_lines_outside",
      params: { start: 2, end: 9, path: "a.txt" },
    });
  });

  test("editing: a comment already sent, an empty text, a comment that does not exist", async () => {
    const { review, store } = reviewSetup();
    const drafted = await review.add(input());
    expect(await refused(() => review.update(drafted.id, " "))).toMatchObject({
      code: "bad_request",
      reason: "review_comment_empty",
    });
    store.db.query("UPDATE review_comments SET state = 'sent' WHERE id = ?").run(drafted.id);
    expect(await refused(() => review.update(drafted.id, "later"))).toMatchObject({
      code: "invalid_state",
      reason: "review_comment_sent",
    });
    expect(await refused(() => review.update("nope", "x"))).toMatchObject({
      code: "not_found",
      reason: "review_comment_not_found",
      params: { id: "nope" },
    });
  });

  test("sending with no draft", async () => {
    const { review } = reviewSetup();
    expect(await refused(() => review.send("session:s-1"))).toMatchObject({
      code: "invalid_state",
      reason: "review_no_drafts",
    });
  });
});

describe("recusas-revisao: the project memory says why it refuses", () => {
  function memorySetup() {
    const claudeDir = tempDir("fd-claude-");
    const { repo } = gitRepo();
    const memory = new ProjectMemory({ claudeDir, clock: () => 0, record: () => {} });
    const dir = join(claudeDir, "projects", repo.replace(/[^A-Za-z0-9]/g, "-"), "memory");
    mkdirSync(dir, { recursive: true });
    return { claudeDir, repo, memory, dir };
  }
  const write = (name: string, over: Record<string, unknown> = {}) => ({
    name,
    content: "x",
    expectedHash: null,
    confirm: true,
    ...over,
  });

  test("a write that is not confirmed, over a file that exists or changed", async () => {
    const { memory, repo, dir } = memorySetup();
    expect(
      await refused(() => memory.write(repo, write("a.md", { confirm: false }))),
    ).toMatchObject({
      code: "invalid_state",
      reason: "memory_write_confirm",
    });
    writeFileSync(join(dir, "a.md"), "old");
    expect(await refused(() => memory.write(repo, write("a.md")))).toMatchObject({
      code: "invalid_state",
      reason: "memory_exists",
      params: { name: "a.md" },
    });
    expect(
      await refused(() => memory.write(repo, write("a.md", { expectedHash: "stale" }))),
    ).toMatchObject({ code: "invalid_state", reason: "memory_changed", params: { name: "a.md" } });
  });

  test("a delete that is not confirmed, of a file that is gone or changed", async () => {
    const { memory, repo, dir } = memorySetup();
    const remove = (over: Record<string, unknown> = {}) => ({
      name: "a.md",
      expectedHash: "h",
      confirm: true,
      ...over,
    });
    expect(await refused(() => memory.remove(repo, remove({ confirm: false })))).toMatchObject({
      code: "invalid_state",
      reason: "memory_delete_confirm",
    });
    expect(await refused(() => memory.remove(repo, remove()))).toMatchObject({
      code: "not_found",
      reason: "memory_not_found",
      params: { name: "a.md" },
    });
    writeFileSync(join(dir, "a.md"), "old");
    expect(await refused(() => memory.remove(repo, remove()))).toMatchObject({
      code: "invalid_state",
      reason: "memory_changed",
      params: { name: "a.md" },
    });
  });

  test("reading a file that is gone", async () => {
    const { memory, repo } = memorySetup();
    expect(await refused(() => memory.read(repo, "gone.md"))).toMatchObject({
      code: "not_found",
      reason: "memory_not_found",
      params: { name: "gone.md" },
    });
  });

  test("a name that is not a plain .md name, and a link", async () => {
    const { memory, repo, dir } = memorySetup();
    expect(await refused(() => memory.read(repo, "../x.md"))).toMatchObject({
      code: "bad_request",
      reason: "memory_name_invalid",
      params: { name: "../x.md" },
    });
    symlinkSync(tmpOutside(), join(dir, "link.md"));
    expect(await refused(() => memory.read(repo, "link.md"))).toMatchObject({
      code: "bad_request",
      reason: "memory_is_link",
      params: { name: "link.md" },
    });
  });

  test("a memory folder that leads out of the Claude folder", async () => {
    const { memory, repo, dir } = memorySetup();
    const out = tempDir("fd-out-");
    const real = dir;
    Bun.spawnSync(["rm", "-rf", real]);
    symlinkSync(out, real);
    expect(await refused(() => memory.read(repo, "a.md"))).toMatchObject({
      code: "bad_request",
      reason: "memory_dir_outside",
    });
  });
});

describe("recusas-revisao: the run environment says why it will not run", () => {
  const YAML = 'run:\n  - name: a\n    cmd: ["x"]\n';
  async function configSetup(source?: string) {
    const ctx = newBoard();
    if (source !== undefined) {
      mkdirSync(join(ctx.repo, ".flightdeck"), { recursive: true });
      writeFileSync(join(ctx.repo, RUN_CONFIG_PATH), source);
      git(ctx.repo, "add", ".flightdeck");
      git(ctx.repo, "commit", "-q", "-m", "run.yaml");
    }
    const project = await ctx.board.addProject({ path: ctx.repo });
    return { project, configs: new RunConfigs({ db: ctx.store.db }) };
  }

  test("no run.yaml on the base branch", async () => {
    const { configs, project } = await configSetup();
    expect(await refused(() => configs.trust(project, "h"))).toMatchObject({
      code: "invalid_state",
      reason: "run_config_missing",
    });
    expect(await refused(() => configs.resolve(project))).toMatchObject({
      code: "invalid_state",
      reason: "run_config_missing",
    });
  });

  test("a file that changed since it was reviewed, that has errors, or that is not trusted", async () => {
    const { configs, project } = await configSetup(YAML);
    expect(await refused(() => configs.trust(project, "stale"))).toMatchObject({
      code: "invalid_state",
      reason: "run_config_changed",
    });
    expect(await refused(() => configs.resolve(project))).toMatchObject({
      code: "invalid_state",
      reason: "run_config_untrusted",
    });
    const bad = await configSetup('run:\n  - name: a\n    cmd: "x"\n');
    const info = await bad.configs.info(bad.project);
    expect(await refused(() => bad.configs.trust(bad.project, info.hash ?? ""))).toMatchObject({
      code: "invalid_state",
      reason: "run_config_invalid",
    });
    const resolved = await refused(() => bad.configs.resolve(bad.project));
    expect(resolved).toMatchObject({ code: "invalid_state", reason: "run_config_invalid" });
    expect(resolved.params?.errors).toBe("run.0.cmd: precisa ser uma lista de textos");
  });

  test("a card with no worktree, and a project that runs one card at a time", async () => {
    const fake = fakeRunHost();
    const store = new EventStore(":memory:");
    const ports = new CardPorts({ db: store.db, isFree: async () => true });
    const noWorktree = new Set(["card-a"]);
    const manager = new RunManager({
      db: store.db,
      configs: { resolve: async () => runConfig({ exclusive: true, setup: null }) },
      ports,
      host: fake.host,
      card: (id) => ({
        id,
        projectId: "proj",
        worktreePath: noWorktree.has(id) ? null : `/work/${id}`,
      }),
      project: (id) => ({ id, path: "/repo", baseBranch: "main" }),
    });
    expect(await refused(() => manager.start("card-a"))).toMatchObject({
      code: "invalid_state",
      reason: "card_no_worktree",
    });
    await manager.start("card-b");
    expect(await refused(() => manager.start("card-c"))).toMatchObject({
      code: "invalid_state",
      reason: "run_exclusive",
    });
    await manager.stop("card-b");
  });

  test("no block of ports left", async () => {
    const store = new EventStore(":memory:");
    const ports = new CardPorts({ db: store.db, base: 65530, isFree: async () => true });
    expect(await refused(() => ports.reserve("card-a", ["web"]))).toMatchObject({
      code: "invalid_state",
      reason: "run_ports_exhausted",
      params: { size: 10 },
    });
  });
});

describe("recusas-revisao: a plugin over the size limit says why it is refused", () => {
  test("the declared size is checked before a byte is read", async () => {
    const dir = tempDir("fd-plugin-");
    writeFileSync(join(dir, "big.bin"), "");
    truncateSync(join(dir, "big.bin"), 50 * 1024 * 1024 + 1);
    expect(await refused(() => inspectPlugin(dir))).toMatchObject({
      code: "bad_request",
      reason: "plugin_too_big",
    });
  });
});
