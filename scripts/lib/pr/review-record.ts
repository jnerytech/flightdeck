/**
 * The record that `/code-review` and `/security-review` ran on a branch (#1707): an empty commit on
 * the branch with two trailers, `Code-Review: <sha> <summary>` and `Security-Review: <sha> <summary>`,
 * each naming the commit it reviewed. `pr open` reads them (the way the security gate reads
 * `Security-Reviewed:`, #273) and refuses a head that no named commit matches: a later commit that
 * changes the branch asks for a new review. A named commit matches by its tree, or when merged onto the head's
 * merge base with the base it gives the head's tree, so a merge of the base into a reviewed branch needs no new record (#3731).
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
  "and push it. A commit that changes the branch after the record asks for a new review; a later merge of origin/main does not.",
];

/**
 * The tree of the reviewed commit merged onto the head's merge base with the base branch: what the head is
 * when its only change since the record is a merge of the base (#3731). Null when git cannot say: no merge
 * base, a git older than 2.38 (no `merge-tree --write-tree`), or a merge that conflicts, whose resolution is
 * a change nobody reviewed. Exact, so a reviewed hunk moved elsewhere, a mode change or a binary cannot match.
 * It runs the checkout's configured merge drivers (the ratchet baselines use one); their result depends only on
 * the base and the reviewed commit, so it cannot carry an unreviewed change.
 */
async function reviewedMergedOntoBase(git: ReviewGit, onto: string, sha: string) {
  const merged = await git(["merge-tree", "--write-tree", "--no-messages", onto, sha]);
  return merged.code === 0 ? (merged.stdout.split("\n")[0] ?? "").trim() || null : null;
}

/** The merge base of the head with the base branch, or null when git has none. */
async function mergeBaseOf(git: ReviewGit, base: string, branch: string) {
  const found = await git(["merge-base", `origin/${base}`, `origin/${branch}`]);
  const onto = found.stdout.trim();
  return found.code === 0 && /^[0-9a-f]{40}$/.test(onto) ? onto : null;
}

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
  // A review counts when a commit it names has the tree of the head (the record's own commit is empty), or
  // merged onto the head's merge base with the base gives it: a merge of the base moves the tree, not the change.
  // `git log -1 --format=%T` prints nothing for a name that is no commit (a tree sha passes rev-parse).
  let mergeBase: Promise<string | null> | undefined;
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
      if (tree.code !== 0 || tree.stdout.trim() === "") continue;
      if (tree.stdout.trim() === head.stdout.trim()) return true;
      mergeBase ??= mergeBaseOf(git, base, branch);
      const onto = await mergeBase;
      if (onto !== null && (await reviewedMergedOntoBase(git, onto, sha)) === head.stdout.trim())
        return true;
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
