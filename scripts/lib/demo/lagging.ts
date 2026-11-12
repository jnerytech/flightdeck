/**
 * #1406: branches that lag behind main, for the demo's Update N from the base. Each is a worktree
 * of its own with one commit; then main gets a commit, so each lags one behind. The last branch
 * changes the README line that main changes too: rebasing it on main conflicts.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DemoGit } from "./teleport.ts";

/** Makes `count` worktrees of `repo` under `worktrees`, then a commit on main; returns them in order. */
export function laggingBranches(
  git: DemoGit,
  repo: string,
  worktrees: string,
  count: number,
): Array<{ branch: string; path: string }> {
  const made: Array<{ branch: string; path: string }> = [];
  for (let i = 1; i <= count; i++) {
    const branch = `fd/atualizar-${i}`;
    const path = join(worktrees, `${repo.split(/[\\/]/).pop()}-${i}`);
    git(repo, "worktree", "add", "-q", "-b", branch, path);
    const [file, text] =
      i === count
        ? ["README.md", "# billing\n\nJuros de 2% ao mês.\n"]
        : [`card-${i}.ts`, `export const card = ${i};\n`];
    writeFileSync(join(path, file), text);
    git(path, "add", file);
    git(path, "commit", "-q", "-m", `card ${i}`);
    made.push({ branch, path });
  }
  writeFileSync(join(repo, "README.md"), "# billing\n\nJuros de 1% ao mês.\n");
  git(repo, "commit", "-q", "-am", "juros");
  return made;
}
