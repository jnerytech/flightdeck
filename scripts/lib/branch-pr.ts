/**
 * The open PR of a branch, from GitHub's `pulls?head=<owner>:<branch>&state=open` (#1115). On
 * 2026-11-08 GitHub answered that query for a branch pushed seconds before with every open PR, and
 * `pr open` took #1111, another session's PR, as the branch's own. So the query reads each PR's
 * head too, and only a PR whose head is the branch counts.
 */

/** The jq for that query: `<number> <head is this repository> <head ref>` per PR (#1124 review). */
export const BRANCH_PR_JQ = String.raw`.[] | "\(.number) \(.head.repo.full_name == .base.repo.full_name) \(.head.ref)"`;

/** One line of that answer. */
const ROW = /^(\d+) (true|false) (.+)$/;

/**
 * The branch's own open PR, or null: a PR of this repository whose head is the branch. `others`
 * names the PRs GitHub listed that are not it (a fork's is marked); a malformed line is skipped.
 */
export function branchPr(stdout: string, branch: string): { own: number | null; others: string[] } {
  const rows = stdout.split("\n").flatMap((line) => {
    const match = ROW.exec(line.trim());
    return match
      ? [{ number: Number(match[1]), here: match[2] === "true", head: match[3] ?? "" }]
      : [];
  });
  const own = rows.find((row) => row.here && row.head === branch);
  if (own) return { own: own.number, others: [] };
  return {
    own: null,
    others: rows.map((row) => `#${row.number} (${row.head}${row.here ? "" : ", a fork"})`),
  };
}

/** Why a run stops when GitHub listed only other branches' PRs for the branch. */
export function otherPrsMessage(branch: string, others: string[]): string {
  return `GitHub listed ${others.join(", ")} for head ${branch}: other branches' PRs, not ${branch}'s. It may not know the branch yet: run this again in a minute, and check \`gh pr list --head ${branch}\` before you act on a PR number (#1115).`;
}
