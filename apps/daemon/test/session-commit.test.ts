import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SecretScanner } from "@flightdeck/protocol";
import { Changes } from "../src/review/changes.ts";
import { SessionCommits } from "../src/review/session-commit.ts";
import { startServer } from "../src/server.ts";
import { git } from "./board-helpers.ts";
import { newManager } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { insertSession } from "./usage-helpers.ts";

/**
 * Issue #1133, slice D1: a plain session's chosen files are committed on a new branch in the
 * person's own checkout, with their hooks. Only what the person saw (by digest) goes in; staged work
 * they did not pick, a merge in progress or a secret refuses; a hook that fails leaves them on the
 * new branch with nothing lost and says how to go back.
 */
// Real git in temporary repositories: more than the default 5 s.
setDefaultTimeout(20_000);

const TARGET = "session:s-1";
const TOKEN = "session-commit-token-0123456789abcd";
const posix = process.platform !== "win32";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** A repository with `a.txt` and `b.txt` committed on main, and a session `s-1` in it. */
function setup(options: { vault?: string[]; cardWorktree?: boolean; timeoutMs?: number } = {}) {
  const ctx = newManager();
  const repo = ctx.project;
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "Ana");
  git(repo, "config", "user.email", "ana@example.com");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "a.txt"), "one\n");
  writeFileSync(join(repo, "b.txt"), "two\n");
  git(repo, "add", "--", "a.txt", "b.txt");
  git(repo, "commit", "-q", "-m", "first");
  insertSession(ctx.store.db, "m-1", "s-1", repo);
  const changes = new Changes({ db: ctx.store.db });
  const commits = new SessionCommits({
    changes,
    scanner: new SecretScanner(() => options.vault ?? []),
    isCardWorktree: () => options.cardWorktree === true,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  return { ctx, repo, changes, commits };
}

/** The digest `changes.get` gives each path now: what the app sends back. */
async function digests(changes: Changes, ...paths: string[]): Promise<Record<string, string>> {
  const { files } = await changes.get(TARGET);
  return Object.fromEntries(
    paths.map((path) => [path, files.find((file) => file.path === path)?.digest ?? "none"]),
  );
}

/** The refusal's reason and params, or "ok". */
async function outcome(run: Promise<unknown>): Promise<string | Record<string, unknown>> {
  try {
    await run;
    return "ok";
  } catch (error) {
    const { reason, params } = error as { reason?: string; params?: Record<string, unknown> };
    return params ? { reason, ...params } : (reason ?? String(error));
  }
}

const branchOf = (repo: string) => git(repo, "rev-parse", "--abbrev-ref", "HEAD");
/**
 * `git status --porcelain`, each line trimmed: the helper trims the output, so only the first line
 * would lose its leading space. Trimmed, `M a.txt` is a change not staged and `M  a.txt` a staged one.
 */
const status = (repo: string) =>
  git(repo, "status", "--porcelain", "--untracked-files=all")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.trim());

describe("session-commit: a plain session's files committed on a new branch (#1133)", () => {
  test("each uncommitted file of a session has its digest: its bytes now, or deleted", async () => {
    const { repo, changes } = setup();
    writeFileSync(join(repo, "a.txt"), "one, changed\n");
    rmSync(join(repo, "b.txt"));
    writeFileSync(join(repo, "c.txt"), "new\n");
    expect(await digests(changes, "a.txt", "b.txt", "c.txt")).toEqual({
      "a.txt": sha("one, changed\n"),
      "b.txt": "deleted",
      "c.txt": sha("new\n"),
    });
  });

  test("the chosen files are committed on a new branch, the rest stay as they were", async () => {
    const { repo, changes, commits } = setup();
    writeFileSync(join(repo, "a.txt"), "one, changed\n");
    writeFileSync(join(repo, "b.txt"), "two, not chosen\n");
    writeFileSync(join(repo, "c.txt"), "new\n");
    const made = await commits.commit(TARGET, {
      files: await digests(changes, "a.txt", "c.txt"),
      message: "Add c\n\nAnd change a.",
      branch: "work/add-c",
    });
    expect([
      { ...made, commit: made.commit.length },
      branchOf(repo),
      git(repo, "show", "--name-status", "--format=%s", "HEAD").split("\n").filter(Boolean),
      status(repo),
      commits.baseOf(repo, "work/add-c"),
    ]).toEqual([
      { branch: "work/add-c", base: "main", commit: 40, files: ["a.txt", "c.txt"] },
      "work/add-c",
      ["Add c", "M\ta.txt", "A\tc.txt"],
      ["M b.txt"],
      "main",
    ]);
  });

  test("a deleted file and a staged rename go in with both their paths", async () => {
    const { repo, changes, commits } = setup();
    rmSync(join(repo, "b.txt"));
    git(repo, "mv", "a.txt", "d.txt");
    const sent = await digests(changes, "b.txt", "d.txt");
    const done = await outcome(
      commits.commit(TARGET, { files: sent, message: "Move a, drop b", branch: "work/move" }),
    );
    expect([
      done,
      git(repo, "show", "--name-status", "--format=", "-M", "HEAD").split("\n").filter(Boolean),
      status(repo),
    ]).toEqual(["ok", ["R100\ta.txt\td.txt", "D\tb.txt"], []]);
  });

  test.skipIf(!posix)(
    "a hook that fails says what it said, leaves the person on the new branch with nothing lost, and names the way back",
    async () => {
      const { repo, changes, commits } = setup();
      const hook = join(repo, ".git", "hooks", "pre-commit");
      writeFileSync(hook, "#!/bin/sh\necho 'lint failed: a.txt'\nexit 1\n");
      chmodSync(hook, 0o755);
      writeFileSync(join(repo, "a.txt"), "one, changed\n");
      writeFileSync(join(repo, "c.txt"), "new\n");
      const before = status(repo);
      const done = await outcome(
        commits.commit(TARGET, {
          files: await digests(changes, "a.txt", "c.txt"),
          message: "Add c",
          branch: "work/hooked",
        }),
      );
      expect([done, branchOf(repo), status(repo), before]).toEqual([
        {
          reason: "changes_commit_hook",
          output: "lint failed: a.txt",
          branch: "work/hooked",
          base: "main",
        },
        "work/hooked",
        ["M a.txt", "?? c.txt"],
        ["M a.txt", "?? c.txt"],
      ]);
    },
  );

  test.skipIf(!posix)("a hook that never ends is stopped at the time limit", async () => {
    const { repo, changes, commits } = setup({ timeoutMs: 400 });
    const hook = join(repo, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nsleep 30\n");
    chmodSync(hook, 0o755);
    writeFileSync(join(repo, "a.txt"), "one, changed\n");
    const done = await outcome(
      commits.commit(TARGET, {
        files: await digests(changes, "a.txt"),
        message: "Change a",
        branch: "work/slow",
      }),
    );
    expect([(done as { reason?: string }).reason, status(repo)]).toEqual([
      "changes_commit_hook",
      ["M a.txt"],
    ]);
  });

  test("what the person did not see, staged work they did not pick, or a merge in progress refuses; nothing moves", async () => {
    const { repo, changes, commits } = setup();
    writeFileSync(join(repo, "a.txt"), "one, changed\n");
    const seen = await digests(changes, "a.txt");
    writeFileSync(join(repo, "a.txt"), "one, changed again\n");
    const stale = await outcome(
      commits.commit(TARGET, { files: seen, message: "m", branch: "work/stale" }),
    );
    writeFileSync(join(repo, "b.txt"), "two, staged\n");
    git(repo, "add", "--", "b.txt");
    const staged = await outcome(
      commits.commit(TARGET, {
        files: await digests(changes, "a.txt"),
        message: "m",
        branch: "work/staged",
      }),
    );
    git(repo, "reset", "-q", "--", "b.txt");
    writeFileSync(join(repo, ".git", "MERGE_HEAD"), `${git(repo, "rev-parse", "HEAD")}\n`);
    const merging = await outcome(
      commits.commit(TARGET, {
        files: await digests(changes, "a.txt"),
        message: "m",
        branch: "work/merge",
      }),
    );
    expect([
      stale,
      staged,
      merging,
      branchOf(repo),
      git(repo, "branch", "--list", "work/*"),
    ]).toEqual([
      "changes_commit_stale",
      { reason: "changes_commit_state", state: "staged" },
      { reason: "changes_commit_state", state: "merge" },
      "main",
      "",
    ]);
  });

  test("a secret in the message or a chosen file, a credential file, a taken or bad branch, or a card refuses", async () => {
    const vault = ["k3y-in-the-vault"];
    const { repo, changes, commits } = setup({ vault });
    writeFileSync(join(repo, "a.txt"), "one, changed\n");
    writeFileSync(join(repo, "c.txt"), "token k3y-in-the-vault\n");
    writeFileSync(join(repo, ".env"), "KEY=1\n");
    git(repo, "branch", "work/taken");
    const attempt = (files: Record<string, string>, message: string, branch: string) =>
      outcome(commits.commit(TARGET, { files, message, branch }));
    const a = await digests(changes, "a.txt");
    const card = setup({ cardWorktree: true });
    writeFileSync(join(card.repo, "a.txt"), "one, changed\n");
    expect([
      await attempt(a, "uses k3y-in-the-vault", "work/one"),
      await attempt(await digests(changes, "c.txt"), "m", "work/two"),
      await attempt({ ".env": "x" }, "m", "work/three"),
      await attempt(a, "m", "work/taken"),
      await attempt(a, "m", "-x"),
      await outcome(commits.commit("card:c-1", { files: a, message: "m", branch: "work/four" })),
      await outcome(
        card.commits.commit(TARGET, {
          files: await digests(card.changes, "a.txt"),
          message: "m",
          branch: "work/five",
        }),
      ),
      branchOf(repo),
      existsSync(join(repo, ".git", "refs", "heads", "work", "one")),
    ]).toEqual([
      { reason: "changes_commit_secret", field: "message" },
      { reason: "changes_commit_secret", file: "c.txt" },
      { reason: "changes_commit_secret", file: ".env" },
      { reason: "changes_commit_branch_taken", branch: "work/taken" },
      { reason: "branch_invalid", name: "-x" },
      "changes_commit_target",
      "changes_commit_target",
      "main",
      false,
    ]);
  });

  test("the server commits only over a near connection, and only once confirmed", async () => {
    const { ctx, repo, changes, commits } = setup();
    writeFileSync(join(repo, "a.txt"), "one, changed\n");
    const base = {
      manager: ctx.manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [ctx.root],
      allowedNetworks: ["0.0.0.0/0", "::/0"],
      changes,
      sessionCommits: commits,
    };
    const servers = [startServer(base), startServer({ ...base, peerOf: () => "8.8.8.8" })];
    const clients = servers.map((server) => new FrameClient(server.url));
    try {
      for (const client of clients) await client.request("hello", { token: TOKEN, client: "t" });
      const [near, far] = clients as [FrameClient, FrameClient];
      const files = await digests(changes, "a.txt");
      const send = async (client: FrameClient, confirm?: boolean) => {
        const ack = await client.request("changes.commit", {
          target: TARGET,
          files,
          message: "Change a",
          branch: "work/server",
          ...(confirm === undefined ? {} : { confirm }),
        });
        const error = ack.error as { reason?: string } | undefined;
        return ack.ok === true ? (ack.data as { branch: string }).branch : (error?.reason ?? null);
      };
      expect([await send(far, true), await send(near), await send(near, true)]).toEqual([
        "transport_refused",
        "changes_commit_confirm",
        "work/server",
      ]);
    } finally {
      for (const client of clients) client.close();
      for (const server of servers) await server.stop();
    }
  });
});
