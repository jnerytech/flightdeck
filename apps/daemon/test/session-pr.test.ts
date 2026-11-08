import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type PrProviderKind, SecretScanner } from "@flightdeck/protocol";
import type { CreatePr } from "../src/board/pr.ts";
import { Changes } from "../src/review/changes.ts";
import { SessionCommits } from "../src/review/session-commit.ts";
import { SessionPrs } from "../src/review/session-pr.ts";
import { startServer } from "../src/server.ts";
import { git, gitRepoWithOrigin } from "./board-helpers.ts";
import { newManager } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { insertSession } from "./usage-helpers.ts";

/**
 * Issue #1133, slice D2: the branch a plain session's commit made is pushed to `origin` and its PR
 * opened, against the branch the commit started from. The base is never pushed, and nothing goes
 * out with a secret in its title or description.
 */
// Real git and a bare `origin`: more than the default 5 s.
setDefaultTimeout(20_000);

const TARGET = "session:s-1";
const TOKEN = "session-pr-token-0123456789abcdefgh";
const URL = "https://github.com/acme/app/pull/7";

function setup(
  options: { vault?: string[]; cardWorktree?: boolean; provider?: PrProviderKind | null } = {},
) {
  const ctx = newManager();
  const { repo, remote } = gitRepoWithOrigin();
  git(repo, "config", "user.name", "Ana");
  git(repo, "config", "user.email", "ana@example.com");
  git(repo, "config", "commit.gpgsign", "false");
  insertSession(ctx.store.db, "m-1", "s-1", repo);
  const scanner = new SecretScanner(() => options.vault ?? []);
  const changes = new Changes({ db: ctx.store.db });
  const isCardWorktree = () => options.cardWorktree === true;
  const commits = new SessionCommits({ changes, scanner, isCardWorktree });
  const created: CreatePr[] = [];
  const provider = {
    create: async (opts: CreatePr) => {
      created.push(opts);
      return URL;
    },
    status: async () => ({ state: "open" as const, checks: null }),
    url: async () => null,
    comments: async () => [],
    health: async () => ({ checks: [], conflicts: false }),
    buildLog: async () => "",
  };
  const prs = new SessionPrs({
    changes,
    commits,
    scanner,
    isCardWorktree,
    projectProvider: () => (options.provider === undefined ? null : options.provider),
    prProvider: (kind) => (kind === "none" ? null : provider),
  });
  return { ctx, repo, remote, changes, commits, prs, created };
}

/** The session's change to `a.txt` committed on `branch` through `changes.commit`. */
async function committed(made: ReturnType<typeof setup>, branch: string) {
  writeFileSync(join(made.repo, "session-note.txt"), "from the session\n");
  const { files } = await made.changes.get(TARGET);
  const digest = files.find((file) => file.path === "session-note.txt")?.digest ?? "";
  await made.commits.commit(TARGET, {
    files: { "session-note.txt": digest },
    message: "Add a note",
    branch,
  });
}

/** Whether the bare `origin` has `branch`. */
const pushed = (remote: string, branch: string) => {
  try {
    git(remote, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`);
    return true;
  } catch {
    return false;
  }
};

/** The branch's upstream, or null when it has none. */
const upstream = (repo: string, branch: string) => {
  try {
    return git(repo, "rev-parse", "--abbrev-ref", `${branch}@{upstream}`);
  } catch {
    return null;
  }
};

async function outcome(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return "ok";
  } catch (error) {
    return (error as { reason?: string }).reason ?? String(error);
  }
}

describe("session-pr: a plain session's branch pushed and its PR opened (#1133)", () => {
  test("the branch the commit made is pushed and its PR opened against the branch it started from", async () => {
    const made = setup();
    await committed(made, "work/note");
    const opened = await made.prs.open(TARGET, { title: "Add a note", body: "What it does." });
    expect([
      opened,
      pushed(made.remote, "work/note"),
      upstream(made.repo, "work/note"),
      made.created.map(({ base, head, title, body }) => ({ base, head, title, body })),
    ]).toEqual([
      { url: URL, branch: "work/note", base: "main" },
      true,
      "origin/work/note",
      [{ base: "main", head: "work/note", title: "Add a note", body: "What it does." }],
    ]);
  });

  test("with no base on record (a restarted daemon), the remote's default branch is the base, or it refuses", async () => {
    const made = setup();
    git(made.repo, "switch", "-q", "-c", "work/by-hand");
    writeFileSync(join(made.repo, "hand.txt"), "by hand\n");
    git(made.repo, "add", "--", "hand.txt");
    git(made.repo, "commit", "-q", "-m", "By hand");
    const before = await outcome(made.prs.open(TARGET, { title: "t", body: "b" }));
    git(made.repo, "remote", "set-head", "origin", "main");
    const after = await made.prs.open(TARGET, { title: "t", body: "b" });
    expect([before, after.base, pushed(made.remote, "work/by-hand")]).toEqual([
      "changes_pr_base",
      "main",
      true,
    ]);
  });

  test("the base is never pushed, nor a detached checkout, nor a secret; a card opens its own PR", async () => {
    const vault = ["k3y-in-the-vault"];
    const onMain = setup({ vault });
    // The remote names its default branch, so the checkout's own branch is known to be the base.
    git(onMain.repo, "remote", "set-head", "origin", "main");
    const sent = (made: ReturnType<typeof setup>, title = "t", body = "b") =>
      outcome(made.prs.open(TARGET, { title, body }));
    const main = await sent(onMain);
    const detached = setup();
    git(detached.repo, "switch", "-q", "--detach", "HEAD");
    const secret = setup({ vault });
    await committed(secret, "work/secret");
    const card = setup({ cardWorktree: true });
    const none = setup({ provider: "none" });
    await committed(none, "work/none");
    expect([
      main,
      await sent(detached),
      await sent(secret, "t", "uses k3y-in-the-vault"),
      await sent(secret, "k3y-in-the-vault", "b"),
      await outcome(secret.prs.open("card:c-1", { title: "t", body: "b" })),
      await sent(card),
      await sent(none),
      pushed(secret.remote, "work/secret"),
      [onMain, secret, none].flatMap((made) => made.created),
    ]).toEqual([
      "changes_pr_on_base",
      "changes_pr_detached",
      "pr_secret",
      "pr_title_secret",
      "changes_pr_target",
      "changes_pr_target",
      "project_no_pr_provider",
      false,
      [],
    ]);
  });

  test("the server opens it only over a near connection, and only once confirmed", async () => {
    const made = setup();
    await committed(made, "work/server");
    const base = {
      manager: made.ctx.manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [made.ctx.root],
      allowedNetworks: ["0.0.0.0/0", "::/0"],
      changes: made.changes,
      sessionPrs: made.prs,
    };
    const servers = [startServer(base), startServer({ ...base, peerOf: () => "8.8.8.8" })];
    const clients = servers.map((server) => new FrameClient(server.url));
    try {
      for (const client of clients) await client.request("hello", { token: TOKEN, client: "t" });
      const [near, far] = clients as [FrameClient, FrameClient];
      const send = async (client: FrameClient, confirm?: boolean) => {
        const ack = await client.request("changes.pr", {
          target: TARGET,
          title: "t",
          body: "b",
          ...(confirm === undefined ? {} : { confirm }),
        });
        const error = ack.error as { reason?: string } | undefined;
        return ack.ok === true ? (ack.data as { url: string }).url : (error?.reason ?? null);
      };
      expect([await send(far, true), await send(near), await send(near, true)]).toEqual([
        "transport_refused",
        "changes_pr_confirm",
        URL,
      ]);
    } finally {
      for (const client of clients) client.close();
      for (const server of servers) await server.stop();
    }
  });
});
