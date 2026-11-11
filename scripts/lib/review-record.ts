/**
 * The record that `/code-review` and `/security-review` ran on a branch (#1707): an empty commit on
 * the branch with two trailers, `Code-Review: <sha> <summary>` and `Security-Review: <sha> <summary>`,
 * each naming the commit it reviewed. `pr open` reads them (the way the security gate reads
 * `Security-Reviewed:`, #273) and refuses a head whose tree no named commit has: a later commit
 * that changes the tree asks for a new review.
 */

/** Runs git with these arguments: its exit code and stdout. */
export type ReviewGit = (args: string[]) => Promise<{ code: number; stdout: string }>;

/** A commit name as git takes it from a trailer: lowercase hex, never an option or a ref. */
const SHA = /^[0-9a-f]{7,40}$/;

/** The sha each value of a review trailer names (its first word), in `git log --format=%x1e<trailers>` output. */
export function parseReviewLog(log: string): string[] {
  return log
    .replaceAll("\x1d", "\x1e")
    .split("\x1e")
    .map((value) => value.trim().split(/\s+/)[0] ?? "")
    .filter((word) => SHA.test(word));
}

/** What to run, and the record to commit, when a review is missing. */
const HOW = [
  "Run /code-review and /security-review on this branch (each in a subagent), fix what they find, then commit their record:",
  '  git commit --allow-empty -m "chore(review): /code-review and /security-review ran on $(git rev-parse --short HEAD) (#N)" \\',
  '    --trailer "Code-Review: $(git rev-parse --short HEAD) <summary>" --trailer "Security-Review: $(git rev-parse --short HEAD) <summary>"',
  "and push it. A commit that changes the tree after the record asks for a new review.",
];

/** Why `pr open` refuses a branch, or null when both reviews are on record for its head. */
export async function reviewProblem(
  branch: string,
  base: string,
  git: ReviewGit,
): Promise<string | null> {
  // One log per trailer key: a control byte in a value cannot move a sha to the other review.
  const trailers = (key: string) =>
    git([
      "log",
      "--no-show-signature",
      `--format=%x1e%(trailers:key=${key},valueonly,unfold,separator=%x1d)`,
      `origin/${base}..origin/${branch}`,
    ]);
  const [codeLog, securityLog, head] = await Promise.all([
    trailers("Code-Review"),
    trailers("Security-Review"),
    git(["rev-parse", "--verify", "--quiet", `origin/${branch}^{tree}`]),
  ]);
  if (codeLog.code !== 0 || securityLog.code !== 0 || head.code !== 0)
    return `review: the log or the head of ${branch} cannot be read`;
  // A review counts when a commit it names has the tree of the head: the record's own commit is empty.
  // `git log -1 --format=%T` prints nothing for a name that is no commit (a tree sha passes rev-parse).
  const reviewed = async (shas: string[]): Promise<boolean> => {
    for (const sha of new Set(shas)) {
      const tree = await git([
        "log",
        "-1",
        "--no-show-signature",
        "--format=%T",
        "--end-of-options",
        sha,
      ]);
      if (tree.code === 0 && tree.stdout.trim() === head.stdout.trim()) return true;
    }
    return false;
  };
  const missing = [
    ...((await reviewed(parseReviewLog(codeLog.stdout))) ? [] : ["/code-review"]),
    ...((await reviewed(parseReviewLog(securityLog.stdout))) ? [] : ["/security-review"]),
  ];
  if (missing.length === 0) return null;
  return [
    `review: no record for the head of ${branch}: missing ${missing.join(" and ")}`,
    ...HOW,
  ].join("\n");
}
