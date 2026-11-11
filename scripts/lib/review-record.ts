/**
 * The record that `/code-review` and `/security-review` ran on a branch (#1707): an empty commit on
 * the branch with two trailers, `Code-Review: <sha> <summary>` and `Security-Review: <sha> <summary>`,
 * each naming the commit it reviewed. `pr open` reads them (the way the security gate reads
 * `Security-Reviewed:`, #273) and refuses a head whose tree no named commit has: a later commit
 * that changes the tree asks for a new review.
 */

/** The commits a branch's `Code-Review` and `Security-Review` trailers name, as written (a sha). */
export interface ReviewNames {
  code: string[];
  security: string[];
}

/** Runs git with these arguments: its exit code and stdout. */
export type ReviewGit = (args: string[]) => Promise<{ code: number; stdout: string }>;

/** A commit name as `git rev-parse` takes it from a trailer: lowercase hex, never an option or a ref. */
const SHA = /^[0-9a-f]{7,40}$/;

/** The sha each value of a trailer names (its first word); the values are joined by \x1d. */
function namedShas(field: string): string[] {
  return field
    .split("\x1d")
    .map((value) => value.trim().split(/\s+/)[0] ?? "")
    .filter((word) => SHA.test(word));
}

/** The names in `git log --format=%x1e<Code-Review trailers>%x1f<Security-Review trailers>` output. */
export function parseReviewLog(log: string): ReviewNames {
  const names: ReviewNames = { code: [], security: [] };
  for (const record of log.split("\x1e")) {
    const [code = "", security = ""] = record.split("\x1f");
    names.code.push(...namedShas(code));
    names.security.push(...namedShas(security));
  }
  return names;
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
  const format =
    "--format=%x1e%(trailers:key=Code-Review,valueonly,unfold,separator=%x1d)" +
    "%x1f%(trailers:key=Security-Review,valueonly,unfold,separator=%x1d)";
  const log = await git(["log", "--no-show-signature", format, `origin/${base}..origin/${branch}`]);
  const head = await git(["rev-parse", "--verify", "--quiet", `origin/${branch}^{tree}`]);
  if (log.code !== 0 || head.code !== 0)
    return `review: the log or the head of ${branch} cannot be read`;
  const names = parseReviewLog(log.stdout);
  // A review counts when a commit it names has the tree of the head: the record's own commit is empty.
  const reviewed = async (shas: string[]): Promise<boolean> => {
    for (const sha of new Set(shas)) {
      const tree = await git([
        "rev-parse",
        "--verify",
        "--quiet",
        "--end-of-options",
        `${sha}^{tree}`,
      ]);
      if (tree.code === 0 && tree.stdout.trim() === head.stdout.trim()) return true;
    }
    return false;
  };
  const missing = [
    ...((await reviewed(names.code)) ? [] : ["/code-review"]),
    ...((await reviewed(names.security)) ? [] : ["/security-review"]),
  ];
  if (missing.length === 0) return null;
  return [
    `review: no record for the head of ${branch}: missing ${missing.join(" and ")}`,
    ...HOW,
  ].join("\n");
}
