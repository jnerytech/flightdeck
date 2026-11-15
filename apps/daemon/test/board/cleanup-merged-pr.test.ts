import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { installFakeCli } from "../../../../scripts/test/fake-cli.ts";
import { reviewedCard } from "../support/board-cleanup.ts";
import { cardWhen, git } from "../support/board-helpers.ts";

// Real git, a bare remote and a fake gh (a Bun process) in several waits: more than the default 5 s.
setDefaultTimeout(20_000);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

describe("limpeza: PR mesclado", () => {
  test("PR mesclado conclui o card e remove a worktree limpa", async () => {
    const gh = installFakeCli("gh", [
      { args: ["view", "url"], code: 1 },
      { args: ["pr", "create"], stdout: "https://github.com/acme/repo/pull/9\n" },
      {
        args: ["view", "state,statusCheckRollup,mergeStateStatus,reviewDecision,createdAt"],
        stdout: JSON.stringify({ state: "OPEN" }),
      },
    ]);
    cleanups.push(gh.restore);
    const { board, card, root, repo, worktree, sessionId, manager } = await reviewedCard(
      cleanups,
      "github",
    );
    git(root, "init", "-q", "--bare", "remote.git");
    git(repo, "remote", "add", "origin", join(root, "remote.git"));
    expect(git(repo, "remote", "get-url", "origin")).toBe(join(root, "remote.git"));
    await board.createPr(card.id);
    gh.respond([
      {
        args: ["view", "state,statusCheckRollup,mergeStateStatus,reviewDecision,createdAt"],
        stdout: JSON.stringify({ state: "MERGED" }),
      },
    ]);
    const done = await cardWhen(board, card.id, (c) => c.worktreePath === null);
    expect(done ?? {}).toMatchObject({ column: "done", prState: "merged" });
    expect(existsSync(worktree)).toBe(false);
    expect(manager.get(sessionId).status).toBe("ended");
  });
});
