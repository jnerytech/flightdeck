import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
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
function setup(
  options: {
    vault?: string[];
    cardWorktree?: boolean;
    timeoutMs?: number;
    afterCheck?: () => Promise<void>;
    /** A pre-commit hook the person had before the session started. */
    hook?: string;
    /** Runs each time the commit has read the changes: a test swaps a file in that moment. */
    afterGet?: () => void;
  } = {},
) {
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
  if (options.hook !== undefined) {
    const hook = join(repo, ".git", "hooks", "pre-commit");
    writeFileSync(hook, options.hook);
    chmodSync(hook, 0o755);
  }
  insertSession(ctx.store.db, "m-1", "s-1", repo);
  const changes = new Changes({ db: ctx.store.db });
  const seen = {
    resolve: changes.resolve.bind(changes),
    get: async (target: string) => {
      const result = await changes.get(target);
      options.afterGet?.();
      return result;
    },
  };
  const commits = new SessionCommits({
    changes: seen,
    scanner: new SecretScanner(() => options.vault ?? []),
    isCardWorktree: () => options.cardWorktree === true,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.afterCheck ? { afterCheck: options.afterCheck } : {}),
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

  test.skipIf(!posix)(
    "the changes name the commit hooks that will run: in the hooks folder, core.hooksPath, or a linked worktree's",
    async () => {
      const own = setup({ hook: "#!/bin/sh\nexit 0\n" });
      const husky = setup();
      mkdirSync(join(husky.repo, ".husky"));
      writeFileSync(join(husky.repo, ".husky", "commit-msg"), "#!/bin/sh\nexit 0\n");
      chmodSync(join(husky.repo, ".husky", "commit-msg"), 0o755);
      writeFileSync(join(husky.repo, ".husky", "post-commit"), "not executable\n");
      // The new branch's switch runs this one too.
      writeFileSync(join(husky.repo, ".husky", "post-checkout"), "#!/bin/sh\nexit 0\n");
      chmodSync(join(husky.repo, ".husky", "post-checkout"), 0o755);
      git(husky.repo, "config", "core.hooksPath", ".husky");
      const linked = setup({ hook: "#!/bin/sh\nexit 0\n" });
      const worktree = join(linked.repo, "..", "linked-worktree");
      git(linked.repo, "worktree", "add", "-q", "-b", "side", worktree);
      insertSession(linked.ctx.store.db, "m-2", "s-2", worktree);
      expect([
        (await own.changes.get(TARGET)).hooks,
        (await husky.changes.get(TARGET)).hooks,
        (await linked.changes.get("session:s-2")).hooks,
      ]).toEqual([["pre-commit"], ["commit-msg", "post-checkout"], ["pre-commit"]]);
    },
  );

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
    ]).toEqual(["ok", ["D\tb.txt", "R100\ta.txt\td.txt"], []]);
  });

  test.skipIf(!posix)(
    "a hook that fails says what it said, leaves the person on the new branch with nothing lost, and names the way back",
    async () => {
      const { repo, changes, commits } = setup({
        hook: "#!/bin/sh\necho 'lint failed: a.txt'\nexit 1\n",
      });
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

  test("a file changed after the check is not committed: the commit is undone and the person stays on the new branch", async () => {
    let repo = "";
    const made = setup({
      vault: ["k3y-in-the-vault"],
      afterCheck: async () => writeFileSync(join(repo, "a.txt"), "now k3y-in-the-vault\n"),
    });
    repo = made.repo;
    const first = git(repo, "rev-parse", "HEAD");
    writeFileSync(join(repo, "a.txt"), "one, changed\n");
    const done = await outcome(
      made.commits.commit(TARGET, {
        files: await digests(made.changes, "a.txt"),
        message: "Change a",
        branch: "work/swapped",
      }),
    );
    expect([done, branchOf(repo), git(repo, "rev-parse", "HEAD") === first, status(repo)]).toEqual([
      { reason: "changes_commit_rewritten", files: "a.txt" },
      "work/swapped",
      true,
      ["M a.txt"],
    ]);
  });

  test.skipIf(!posix)(
    "what a hook said is withheld whole when a secret is anywhere in it, even cut",
    async () => {
      const { repo, changes, commits } = setup({
        vault: ["k3y-in-the-vault"],
        hook: `#!/bin/sh\necho 'k3y-in-the-vault'\nprintf '%01995d\\n' 0\nexit 1\n`,
      });
      writeFileSync(join(repo, "a.txt"), "one, changed\n");
      const done = await outcome(
        commits.commit(TARGET, {
          files: await digests(changes, "a.txt"),
          message: "Change a",
          branch: "work/said",
        }),
      );
      expect([JSON.stringify(done).includes("k3y"), done]).toEqual([
        false,
        { reason: "changes_commit_hook_withheld", branch: "work/said", base: "main" },
      ]);
    },
  );

  test.skipIf(!posix)("a hook that never ends is stopped at the time limit", async () => {
    const { repo, changes, commits } = setup({ timeoutMs: 400, hook: "#!/bin/sh\nsleep 30\n" });
    writeFileSync(join(repo, "a.txt"), "one, changed\n");
    const done = await outcome(
      commits.commit(TARGET, {
        files: await digests(changes, "a.txt"),
        message: "Change a",
        branch: "work/slow",
      }),
    );
    expect([(done as { reason?: string }).reason, status(repo)]).toEqual([
      "changes_commit_timeout",
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
    if (posix) symlinkSync("k3y-in-the-vault", join(repo, "link"));
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
      posix
        ? await attempt(await digests(changes, "link"), "m", "work/link")
        : { reason: "changes_commit_secret", file: "link" },
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
      "changes_commit_message_secret",
      { reason: "changes_commit_secret", file: "c.txt" },
      { reason: "changes_commit_secret", file: ".env" },
      { reason: "changes_commit_secret", file: "link" },
      { reason: "changes_commit_branch_taken", branch: "work/taken" },
      { reason: "branch_invalid", name: "-x" },
      "changes_commit_target",
      "changes_commit_target",
      "main",
      false,
    ]);
  });

  test.skipIf(!posix)(
    "a hook that reformats a file undoes the commit and names it; committed again as it is now, it goes in",
    async () => {
      const { repo, changes, commits } = setup({
        hook: "#!/bin/sh\ntr a-z A-Z < a.txt > a.tmp && mv a.tmp a.txt && git add a.txt\n",
      });
      writeFileSync(join(repo, "a.txt"), "one, changed\n");
      const first = await outcome(
        commits.commit(TARGET, {
          files: await digests(changes, "a.txt"),
          message: "Change a",
          branch: "work/format",
        }),
      );
      const again = await outcome(
        commits.commit(TARGET, {
          files: await digests(changes, "a.txt"),
          message: "Change a",
          branch: "work/format-2",
        }),
      );
      expect([first, again, git(repo, "show", "HEAD:a.txt")]).toEqual([
        { reason: "changes_commit_rewritten", files: "a.txt" },
        "ok",
        "ONE, CHANGED",
      ]);
    },
  );

  test.skipIf(!posix)("a chosen path that became a pipe is refused, never opened", async () => {
    let swap = false;
    let repo = "";
    const made = setup({
      afterGet: () => {
        if (!swap) return;
        rmSync(join(repo, "c.txt"));
        execFileSync("mkfifo", [join(repo, "c.txt")]);
      },
    });
    repo = made.repo;
    const { changes, commits } = made;
    writeFileSync(join(repo, "c.txt"), "new\n");
    const files = await digests(changes, "c.txt");
    swap = true;
    const done = await Promise.race([
      outcome(commits.commit(TARGET, { files, message: "m", branch: "work/pipe" })),
      // timing: an open of a pipe with no writer never returns; the race turns that hang into a value.
      Bun.sleep(3000).then(() => "hung"),
    ]);
    if (done === "hung") {
      // Let the stuck open go: a writer for the pipe.
      const writer = await open(join(repo, "c.txt"), "w");
      await writer.close();
    }
    expect(done).toBe("changes_commit_stale");
  });

  test("a renamed file's old path is part of the commit: recreated meanwhile, it is not committed", async () => {
    let repo = "";
    const made = setup({
      afterCheck: async () => writeFileSync(join(repo, "a.txt"), "back again\n"),
    });
    repo = made.repo;
    git(repo, "mv", "a.txt", "d.txt");
    const done = await outcome(
      made.commits.commit(TARGET, {
        files: await digests(made.changes, "d.txt"),
        message: "Move a",
        branch: "work/back",
      }),
    );
    expect(done).toEqual({ reason: "changes_commit_rewritten", files: "a.txt" });
  });

  test("a file over 8 MiB is never hashed on a refresh, and refuses at once", async () => {
    const { repo, changes, commits } = setup();
    writeFileSync(join(repo, "big.bin"), Buffer.alloc(9 * 1024 * 1024, 1));
    const files = await digests(changes, "big.bin");
    expect([
      files,
      await outcome(commits.commit(TARGET, { files, message: "m", branch: "work/big" })),
    ]).toEqual([
      { "big.bin": "too-large" },
      { reason: "changes_commit_too_large", file: "big.bin" },
    ]);
  });

  test("two commits of one checkout at once run one after the other", async () => {
    const { repo, changes, commits } = setup();
    writeFileSync(join(repo, "a.txt"), "one, changed\n");
    const files = await digests(changes, "a.txt");
    const both = await Promise.all(
      ["work/first", "work/second"].map((branch) =>
        outcome(commits.commit(TARGET, { files, message: "m", branch })),
      ),
    );
    // One after the other, in whichever order they reach the checkout: one goes in, the other then
    // finds its file committed.
    const branches = git(repo, "branch", "--list", "work/*").replaceAll(/[ *]/g, "").split("\n");
    expect([[...both].sort(), branches.length]).toEqual([["changes_commit_stale", "ok"], 1]);
  });

  test.skipIf(!posix)(
    "from a detached checkout, the way back is the commit it was on",
    async () => {
      const { repo, changes, commits } = setup({ hook: "#!/bin/sh\nexit 1\n" });
      git(repo, "switch", "-q", "--detach", "HEAD");
      const at = git(repo, "rev-parse", "HEAD");
      writeFileSync(join(repo, "a.txt"), "one, changed\n");
      const done = await outcome(
        commits.commit(TARGET, {
          files: await digests(changes, "a.txt"),
          message: "m",
          branch: "work/detached",
        }),
      );
      expect((done as { base?: string }).base).toBe(at);
    },
  );

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
