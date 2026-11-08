/**
 * The open PR of a branch, from GitHub's `pulls?head=<owner>:<branch>&state=open` (#1115). On
 * 2026-11-08 GitHub answered that query for a branch pushed seconds before with every open PR, and
 * `pr open` took #1111, another session's PR, as the branch's own. So the query reads each PR's
 * head too, and only a PR whose head is the branch counts.
 */

/** The jq for that query: one `<number> <head ref>` line per PR. */
export const BRANCH_PR_JQ = String.raw`.[] | "\(.number) \(.head.ref)"`;

/** The branch's own open PR, or null; `others` names the PRs of other branches GitHub listed. */
export function branchPr(stdout: string, branch: string): { own: number | null; others: string[] } {
  const rows = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const space = line.indexOf(" ");
      return space === -1
        ? { number: Number(line), head: "" }
        : { number: Number(line.slice(0, space)), head: line.slice(space + 1) };
    });
  const own = rows.find((row) => row.head === branch);
  if (own) return { own: own.number, others: [] };
  return { own: null, others: rows.map((row) => `#${row.number} (${row.head})`) };
}

/** Why a run stops when GitHub listed only other branches' PRs for the branch. */
export function otherPrsMessage(branch: string, others: string[]): string {
  return `GitHub listed ${others.join(", ")} for head ${branch}: other branches' PRs, not ${branch}'s. It may not know the branch yet: run this again in a minute, and check \`gh pr list --head ${branch}\` before you act on a PR number (#1115).`;
}
