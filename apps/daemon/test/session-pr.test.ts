import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
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
  options: {
    vault?: string[];
    cardWorktree?: boolean;
    provider?: PrProviderKind | null;
    pushTimeoutMs?: number;
  } = {},
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
    ...(options.pushTimeoutMs === undefined ? {} : { pushTimeoutMs: options.pushTimeoutMs }),
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

/** A `pre-push` hook in the checkout running `script`. */
function prePush(repo: string, script: string) {
  const hook = join(repo, ".git", "hooks", "pre-push");
  writeFileSync(hook, `#!/bin/sh\n${script}\n`);
  chmodSync(hook, 0o755);
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

/** The push address `changes.get` shows the person: what the app sends back. */
const seenRemote = async (made: ReturnType<typeof setup>) =>
  (await made.changes.get(TARGET)).remote ?? "none";

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
    const remote = await seenRemote(made);
    const opened = await made.prs.open(TARGET, {
      title: "Add a note",
      body: "What it does.",
      remote,
    });
    expect([
      remote,
      opened,
      pushed(made.remote, "work/note"),
      upstream(made.repo, "work/note"),
      made.created.map(({ base, head, title, body }) => ({ base, head, title, body })),
    ]).toEqual([
      made.remote,
      { url: URL, branch: "work/note", base: "main" },
      true,
      "origin/work/note",
      [{ base: "main", head: "work/note", title: "Add a note", body: "What it does." }],
    ]);
  });

  test("a branch this daemon's commit did not make is never pushed, whatever the remote calls its default", async () => {
    const made = setup();
    git(made.repo, "switch", "-q", "-c", "work/by-hand");
    writeFileSync(join(made.repo, "hand.txt"), "by hand\n");
    git(made.repo, "add", "--", "hand.txt");
    git(made.repo, "commit", "-q", "-m", "By hand");
    // A session may point the remote's default anywhere: it never stands in for the record.
    git(made.repo, "remote", "set-head", "origin", "main");
    const done = await outcome(
      made.prs.open(TARGET, { title: "t", body: "b", remote: await seenRemote(made) }),
    );
    expect([done, pushed(made.remote, "work/by-hand"), made.created]).toEqual([
      "changes_pr_base",
      false,
      [],
    ]);
  });

  test("the push goes where the person saw: a remote changed since refuses, and its address never carries a password", async () => {
    const made = setup();
    await committed(made, "work/moved");
    const seen = await seenRemote(made);
    const elsewhere = join(made.remote, "..", "elsewhere.git");
    git(made.repo, "init", "-q", "--bare", elsewhere);
    git(made.repo, "remote", "set-url", "--push", "origin", elsewhere);
    const done = await outcome(made.prs.open(TARGET, { title: "t", body: "b", remote: seen }));
    git(
      made.repo,
      "remote",
      "set-url",
      "--push",
      "origin",
      "https://ana:s3cret@example.com/app.git",
    );
    expect([
      done,
      pushed(made.remote, "work/moved"),
      pushed(elsewhere, "work/moved"),
      await seenRemote(made),
    ]).toEqual(["changes_pr_remote", false, false, "https://example.com/app.git"]);
  });

  test("a branch moved since the app's commit is never pushed: only the commit the person made goes out", async () => {
    const made = setup();
    await committed(made, "work/moved-on");
    writeFileSync(join(made.repo, "later.txt"), "added by the session afterwards\n");
    git(made.repo, "add", "--", "later.txt");
    git(made.repo, "commit", "-q", "-m", "Later");
    const done = await outcome(
      made.prs.open(TARGET, { title: "t", body: "b", remote: await seenRemote(made) }),
    );
    expect([done, pushed(made.remote, "work/moved-on"), made.created]).toEqual([
      "changes_pr_moved",
      false,
      [],
    ]);
  });

  test("the push sends the branch alone: no tag follows it, whatever the checkout's settings", async () => {
    const made = setup();
    await committed(made, "work/tagged");
    git(made.repo, "config", "push.followTags", "true");
    git(made.repo, "tag", "-a", "v9", "-m", "a tag the person never chose");
    const done = await outcome(
      made.prs.open(TARGET, { title: "t", body: "b", remote: await seenRemote(made) }),
    );
    const tagged = (() => {
      try {
        git(made.remote, "rev-parse", "--verify", "--quiet", "refs/tags/v9");
        return true;
      } catch {
        return false;
      }
    })();
    expect([done, pushed(made.remote, "work/tagged"), tagged]).toEqual(["ok", true, false]);
  });

  test("no password, query or fragment of the push address reaches the person, shown or in a failed push's output", async () => {
    const made = setup();
    await committed(made, "work/refused");
    // Nothing listens on port 1: the push fails at once, and git's message quotes the address.
    git(
      made.repo,
      "remote",
      "set-url",
      "--push",
      "origin",
      "https://ana:p@ss@127.0.0.1:1/app.git?token=t0ken-in-query#frag",
    );
    const seen = await seenRemote(made);
    let said = "";
    try {
      await made.prs.open(TARGET, { title: "t", body: "b", remote: seen });
    } catch (error) {
      said = JSON.stringify([String(error), (error as { details?: unknown }).details]);
    }
    expect([
      seen,
      said.includes("127.0.0.1"),
      ["ana", "p@ss", "ss@", "t0ken", "frag"].filter((leak) => said.includes(leak)),
    ]).toEqual(["https://127.0.0.1:1/app.git", true, []]);
  });

  test("a base with commits not on origin refuses: they would go out with the PR unseen", async () => {
    const made = setup();
    writeFileSync(join(made.repo, "local.txt"), "never pushed\n");
    git(made.repo, "add", "--", "local.txt");
    git(made.repo, "commit", "-q", "-m", "Local only");
    await committed(made, "work/ahead");
    const done = await outcome(
      made.prs.open(TARGET, { title: "t", body: "b", remote: await seenRemote(made) }),
    );
    expect([done, pushed(made.remote, "work/ahead"), made.created]).toEqual([
      "changes_pr_ahead",
      false,
      [],
    ]);
  });

  test("a push that runs past its limit says so, and a failed push's output with a secret is withheld", async () => {
    const vault = ["k3y-in-the-vault"];
    const slow = setup({ pushTimeoutMs: 300 });
    await committed(slow, "work/slow");
    prePush(slow.repo, "sleep 5");
    const leaky = setup({ vault });
    await committed(leaky, "work/leaky");
    prePush(leaky.repo, "echo 'token k3y-in-the-vault' >&2; exit 1");
    let said = "";
    const withheld = await (async () => {
      try {
        await leaky.prs.open(TARGET, { title: "t", body: "b", remote: await seenRemote(leaky) });
        return "ok";
      } catch (error) {
        said = JSON.stringify([String(error), (error as { details?: unknown }).details]);
        return (error as { reason?: string }).reason ?? "";
      }
    })();
    expect([
      await outcome(slow.prs.open(TARGET, { title: "t", body: "b", remote: await seenRemote(slow) })),
      withheld,
      said.includes("k3y-in-the-vault"),
      [slow, leaky].flatMap((made) => made.created),
    ]).toEqual(["pr_push_timeout", "pr_push_withheld", false, []]);
  });

  test("the base is never pushed, nor a detached checkout, nor a secret; a card opens its own PR", async () => {
    const vault = ["k3y-in-the-vault"];
    const onMain = setup({ vault });
    git(onMain.repo, "remote", "set-head", "origin", "main");
    const sent = async (made: ReturnType<typeof setup>, title = "t", body = "b") =>
      outcome(made.prs.open(TARGET, { title, body, remote: await seenRemote(made) }));
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
      await outcome(secret.prs.open("card:c-1", { title: "t", body: "b", remote: secret.remote })),
      await sent(card),
      await sent(none),
      pushed(secret.remote, "work/secret"),
      [onMain, secret, none].flatMap((made) => made.created),
    ]).toEqual([
      "changes_pr_base",
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
      const remote = await seenRemote(made);
      const send = async (client: FrameClient, confirm?: boolean) => {
        const ack = await client.request("changes.pr", {
          target: TARGET,
          title: "t",
          body: "b",
          remote,
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
