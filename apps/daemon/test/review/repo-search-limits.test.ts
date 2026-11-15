import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ReviewFiles } from "../../src/review/files.ts";
import { MAX_SEARCHES, searchRepository } from "../../src/review/search.ts";
import { startServer } from "../../src/server.ts";
import { git } from "../support/board-helpers.ts";
import { tempDir } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { insertSession } from "../support/usage-helpers.ts";
import { cleanups, failure, setup, TOKEN, teardown } from "./repo-search-setup.ts";

afterEach(teardown);

describe("repo-search-limits: refused folders, the search slots, aborts and the protocol (#806, #905)", () => {
  test("a folder that is no repository is refused by name and by content", async () => {
    const plain = tempDir("fd-plain-");
    writeFileSync(join(plain, "panel.ts"), "panel\n");
    expect([
      await failure(searchRepository(plain, { mode: "name", query: "panel" })),
      await failure(
        searchRepository(plain, { mode: "content", query: "panel" }, { rg: () => null }),
      ),
    ]).toEqual(["repo_not_git", "repo_not_git"]);
  });

  test("a repository whose own config points git at another tree is refused, by name and by content (#806)", async () => {
    const { repo } = await setup();
    // `core.worktree` sends git to a tree that is not the folder: its files must never be searched.
    const other = tempDir("fd-other-tree-");
    writeFileSync(join(other, "panel.ts"), "panel from the other tree\n");
    git(repo, "config", "core.worktree", other);
    expect([
      await failure(searchRepository(repo, { mode: "name", query: "panel" })),
      await failure(
        searchRepository(repo, { mode: "content", query: "panel" }, { rg: () => null }),
      ),
    ]).toEqual(["repo_not_git", "repo_not_git"]);
  });

  test("a core.worktree that is not there is refused too (#806)", async () => {
    const { repo } = await setup();
    git(repo, "config", "core.worktree", join(tempDir("fd-gone-tree-"), "gone"));
    expect(await failure(searchRepository(repo, { mode: "name", query: "panel" }))).toBe(
      "repo_not_git",
    );
  });

  test("searches running at once are limited: the one past the limit is refused with a reason, and a slot comes back when one ends (#806)", async () => {
    const { repo } = await setup();
    const gate = Promise.withResolvers<void>();
    const slow = {
      rg: () => "rg",
      run: async (cmd: string[]) => {
        // Only the searches for "held" wait for the gate: one past them must not hang a red.
        if (cmd.includes("held")) await gate.promise;
        return { code: 1, stdout: "", stderr: "", truncated: false };
      },
    };
    const held = { mode: "content", query: "held" } as const;
    const extra = { mode: "content", query: "extra" } as const;
    const running = Array.from({ length: MAX_SEARCHES }, () => searchRepository(repo, held, slow));
    const refused = await failure(searchRepository(repo, extra, slow));
    gate.resolve();
    await Promise.all(running);
    // A refusal holds no slot, and an ended search gave its slot back.
    const after = await failure(searchRepository(repo, extra, slow));
    expect([refused, after]).toEqual(["search_busy", "ok"]);
  });

  test("a search that fails gives its slot back too (#806)", async () => {
    const plain = tempDir("fd-plain-slot-");
    // One after the other, more than the limit allows at once: each failure must free its slot.
    const failed: string[] = [];
    for (let i = 0; i < MAX_SEARCHES * 2; i += 1) {
      failed.push(await failure(searchRepository(plain, { mode: "name", query: "x" })));
    }
    expect(failed.every((reason) => reason === "repo_not_git")).toBe(true);
  });

  test("a search whose signal is already aborted is superseded, and runs nothing (#905)", async () => {
    const { repo } = await setup();
    const controller = new AbortController();
    controller.abort();
    const ran: string[][] = [];
    const run: typeof import("../../src/kernel/command.ts").runLimited = async (cmd) => {
      ran.push(cmd);
      return { code: 1, stdout: "", stderr: "", truncated: false };
    };
    const outcome = await failure(
      searchRepository(
        repo,
        { mode: "content", query: "panel" },
        { rg: () => "rg", run, signal: controller.signal },
      ),
    );
    expect([outcome, ran]).toEqual(["search_superseded", []]);
  });

  test("an aborted search frees its slot at once, before its programs have ended (#905)", async () => {
    const { repo } = await setup();
    const gate = Promise.withResolvers<void>();
    // The held searches ignore the abort and end only when the gate opens: a slow kill.
    const run: typeof import("../../src/kernel/command.ts").runLimited = async (cmd) => {
      if (cmd.includes("held")) await gate.promise;
      return { code: 1, stdout: "", stderr: "", truncated: false };
    };
    const held = { mode: "content", query: "held" } as const;
    const extra = { mode: "content", query: "extra" } as const;
    const controller = new AbortController();
    const running = Array.from({ length: MAX_SEARCHES }, (_, i) =>
      searchRepository(repo, held, {
        rg: () => "rg",
        run,
        ...(i === 0 ? { signal: controller.signal } : {}),
      }).catch((error: { reason?: string }) => error.reason ?? "error"),
    );
    controller.abort();
    const next = await failure(searchRepository(repo, extra, { rg: () => "rg", run }));
    gate.resolve();
    const ended = await Promise.all(running);
    expect([next, ended[0], ended.slice(1).every((r) => typeof r !== "string")]).toEqual([
      "ok",
      "search_superseded",
      true,
    ]);
  });

  test("a new search on a connection aborts that connection's earlier one, and another connection's is left alone (#905)", async () => {
    const ctx = await setup();
    const started = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const other = Promise.withResolvers<void>();
    const answer = { code: 1, stdout: "", stderr: "", truncated: false };
    // "first" runs until it is aborted or the second search has run; "other" is on its own connection.
    const run: typeof import("../../src/kernel/command.ts").runLimited = async (
      cmd,
      _cwd,
      _limit,
      _timeout,
      _kill,
      more,
    ) => {
      const signal = more?.signal;
      if (cmd.includes("first")) {
        started.resolve();
        await Promise.race([
          second.promise,
          new Promise((resolve) => signal?.addEventListener("abort", resolve, { once: true })),
        ]);
        return signal?.aborted ? { ...answer, aborted: true } : answer;
      }
      if (cmd.includes("second")) second.resolve();
      if (cmd.includes("other")) other.resolve();
      return answer;
    };
    const files = new ReviewFiles({
      changes: ctx.changes,
      dataDir: tempDir("fd-data-"),
      allowedRoots: [ctx.root],
      search: { rg: () => "rg", run },
    });
    const server = startServer({
      manager: ctx.manager,
      review: { files },
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [ctx.root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    const elsewhere = new FrameClient(server.url);
    cleanups.push(() => client.close());
    cleanups.push(() => elsewhere.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    await elsewhere.request("hello", { token: TOKEN, client: "t" });
    const search = (query: string) => ({ target: ctx.target, mode: "content", query });
    const first = client.request("file.search", search("first"));
    await started.promise;
    // Another connection searching does not touch the first one's search.
    await elsewhere.request("file.search", search("other"));
    await other.promise;
    const next = await client.request("file.search", search("second"));
    const earlier = await first;
    const why = (ack: Record<string, unknown>) =>
      (ack.error as { reason?: string } | undefined)?.reason ?? null;
    expect([earlier.ok, why(earlier), next.ok]).toEqual([false, "search_superseded", true]);
  });

  test("a search runs on a repository inside the allowed roots, never a terminal's folder or a session's elsewhere", async () => {
    const { changes, target, root, store } = await setup();
    const files = new ReviewFiles({ changes, dataDir: tempDir("fd-data-"), allowedRoots: [root] });
    // A session that ran in a repository outside the roots (an external one, the home's dotfiles).
    const elsewhere = join(tempDir("fd-elsewhere-"), "dotfiles");
    mkdirSync(elsewhere);
    Bun.spawnSync(["git", "init", "-q", elsewhere]);
    insertSession(store.db, "m-out", "s-out", elsewhere);
    const found = await files.search({ target, mode: "name", query: "panel.ts" }).catch(() => null);
    expect([
      found?.matches ?? null,
      await failure(files.search({ target: "terminal:t1", mode: "name", query: "x" })),
      await failure(files.search({ target: "session:s-out", mode: "content", query: "x" })),
    ]).toEqual([[{ path: "src/panel.ts" }], "review_target_invalid", "cwd_outside_roots"]);
  });

  test("the host announces file.search and answers it over the protocol", async () => {
    const ctx = await setup();
    const files = new ReviewFiles({
      changes: ctx.changes,
      dataDir: tempDir("fd-data-"),
      allowedRoots: [ctx.root],
    });
    const server = startServer({
      manager: ctx.manager,
      review: { files },
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [ctx.root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const info = await client.data<{ features?: string[] }>("host.info", {});
    const found = await client.data<{ matches: Array<{ path: string }> }>("file.search", {
      target: ctx.target,
      mode: "name",
      query: "readme-panel",
    });
    expect([info?.features?.includes("file.search") ?? false, found?.matches ?? null]).toEqual([
      true,
      [{ path: "notes/Readme-Panel.md" }],
    ]);
  });
});
