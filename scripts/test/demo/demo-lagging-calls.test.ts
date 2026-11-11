import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { laggingBranches } from "../../lib/demo-lagging.ts";
import { realTempDir } from "../temp-dir.ts";

const cleanups: string[] = [];
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * #1406: what the demo's lagging branches ask git to do, with a git that only records. The real
 * rebase on them is `demo-lagging.test.ts`.
 */
describe("demo-lagging: what it asks git to do (#1406)", () => {
  test("a worktree and a commit per branch, the last one on the README, then one commit on main", () => {
    const root = realTempDir("fd-demo-billing-calls-");
    cleanups.push(root);
    const repo = join(root, "billing");
    const worktrees = join(root, "worktrees");
    mkdirSync(repo, { recursive: true });
    const calls: string[] = [];
    // It records each call; `worktree add` makes the folder, as git does.
    const git = (cwd: string, ...args: string[]) => {
      calls.push(`${cwd.replace(root, "")}: ${args.join(" ").replace(root, "")}`);
      if (args[0] === "worktree") mkdirSync(args.at(-1) as string, { recursive: true });
    };
    const made = laggingBranches(git, repo, worktrees, 2);
    expect({
      made: made.map((m) => `${m.branch} ${m.path.replace(root, "")}`),
      calls,
      last: readFileSync(join(worktrees, "billing-2", "README.md"), "utf8"),
      main: readFileSync(join(repo, "README.md"), "utf8"),
    }).toEqual({
      made: ["fd/atualizar-1 /worktrees/billing-1", "fd/atualizar-2 /worktrees/billing-2"],
      calls: [
        "/billing: worktree add -q -b fd/atualizar-1 /worktrees/billing-1",
        "/worktrees/billing-1: add card-1.ts",
        "/worktrees/billing-1: commit -q -m card 1",
        "/billing: worktree add -q -b fd/atualizar-2 /worktrees/billing-2",
        "/worktrees/billing-2: add README.md",
        "/worktrees/billing-2: commit -q -m card 2",
        "/billing: commit -q -am juros",
      ],
      last: "# billing\n\nJuros de 2% ao mês.\n",
      main: "# billing\n\nJuros de 1% ao mês.\n",
    });
  });
});
