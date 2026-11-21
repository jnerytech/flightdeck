/**
 * The record that `/code-review` and `/security-review` ran on a branch (#1707): an empty commit on
 * the branch with two trailers, `Code-Review: <sha> <summary>` and `Security-Review: <sha> <summary>`,
 * each naming the commit it reviewed. `pr open` reads them (the way the security gate reads
 * `Security-Reviewed:`, #273) and refuses a head that no named commit matches: a later commit that
 * changes the branch asks for a new review. A named commit matches by its tree, or by its branch-side
 * change (its diff against the base), so a merge of the base into a reviewed branch needs no new record (#3731).
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
 * The change a commit makes on its branch's side: its diff against the merge base with the base
 * branch, with what a merge of the base moves left out (blob ids, line numbers), or null when git
 * cannot print it. `--binary` keeps a binary change in the text and `--no-renames` keeps a moved file from
 * hiding behind a guess, so two equal texts are the same change.
 */
async function branchSideChange(git: ReviewGit, base: string, rev: string): Promise<string | null> {
  const diff = await git([
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    "--binary",
    `origin/${base}...${rev}`,
    "--",
  ]);
  if (diff.code !== 0) return null;
  return diff.stdout
    .split("\n")
    .filter((line) => !line.startsWith("index "))
    .map((line) => line.replace(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/, "@@"))
    .join("\n");
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
  // the same branch-side change: a merge of the base moves the tree but not what the branch changes.
  // `git log -1 --format=%T` prints nothing for a name that is no commit (a tree sha passes rev-parse).
  let headChange: Promise<string | null> | undefined;
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
      headChange ??= branchSideChange(git, base, `origin/${branch}`);
      const [own, theirs] = await Promise.all([headChange, branchSideChange(git, base, sha)]);
      if (own !== null && own === theirs) return true;
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
