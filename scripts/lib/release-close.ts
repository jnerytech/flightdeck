import { inSequence } from "@flightdeck/protocol";
/**
 * `bun run release:close -- <tag> [--apply] [--since <tag>]` (issue #252): after a release tag, the
 * issues the tag ships get "Shipped in <tag>", are closed and go to Done on the board, and the
 * milestone named after the tag is closed once nothing in it is open. An issue ships when a merged
 * pull request of the range closes it (its closingIssuesReferences) or a commit says
 * `Closes/Fixes/Resolves #N` (#367); an issue only referenced (a docs mention, a partial commit, a
 * PR that said Refs) is named and left open. A dry run by default, and a second run repeats nothing.
 */

export interface GhResult {
  code: number;
  stdout: string;
}

export interface ReleaseCloseDeps {
  /** Runs `gh <args>` (REST through `gh api`); the caller owns the login. */
  gh(args: string[]): Promise<GhResult>;
  /** Runs `git <args>` in the repository. */
  git(args: string[]): Promise<GhResult>;
  /** Puts the issue on Done on the board (the REST queue of #242); absent: the board is skipped. */
  board?(issue: number): Promise<boolean>;
  log(line: string): void;
}

/** `gh api` fills in the current repository. */
const REPO = "repos/{owner}/{repo}";
/** A body line that closes: `Closes #12`, `fixes #12`, `Resolves #12`. */
const CLOSING_LINE = /^\s*(?:closes|fixes|resolves)\s+#(\d+)/i;
/** A subject that closes, said after a comma or a dash: `fix(x): y, closes #12`. */
const CLOSING_SUBJECT = /\b(?:closes|fixes|resolves)\s+#(\d+)/i;
/** The subject of the merge commit GitHub makes for a pull request. */
const MERGE_SUBJECT = /^Merge pull request #(\d+)\b/;

/** A release tag, and so a `--since`: a word that is never an option or a range for git. */
const TAG = /^v\d+\.\d+\.\d+$/;
/** An issue title as one line of text: a control character (an escape sequence, a newline) is a space. */
const plain = (text: string) => text.replace(/\p{Cc}/gu, " ");

const numbers = (text: string) => [...text.matchAll(/#(\d+)\b/g)].map((m) => Number(m[1]));
const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);

/**
 * The issues a tag's commits close (a `Closes/Fixes/Resolves #N` line, in a subject or a body) and
 * the ones they only reference. A merge commit's own pull request number is neither.
 */
export function issueRefs(log: string): { closes: number[]; mentioned: number[] } {
  const closes = new Set<number>();
  const referenced = new Set<number>();
  for (const record of log.split("\x1e")) {
    const [subject = "", body = ""] = record.replace(/^\n/, "").split("\x1f");
    if (MERGE_SUBJECT.test(subject)) continue;
    const closingSubject = CLOSING_SUBJECT.exec(subject);
    if (closingSubject) closes.add(Number(closingSubject[1]));
    for (const n of numbers(subject)) referenced.add(n);
    for (const line of body.split("\n")) {
      const closing = CLOSING_LINE.exec(line);
      if (closing) closes.add(Number(closing[1]));
      for (const n of numbers(line)) referenced.add(n);
    }
  }
  return {
    closes: sorted(closes),
    mentioned: sorted(new Set([...referenced].filter((n) => !closes.has(n)))),
  };
}

/** The pull requests merged into the range, from the subjects of its merge commits. */
export function mergedPulls(subjects: string): number[] {
  return subjects
    .split("\n")
    .map((line) => MERGE_SUBJECT.exec(line)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);
}

interface Planned {
  issue: number;
  title: string;
  open: boolean;
  /** Its milestone's number, if any. */
  milestone?: number;
  /** It already carries this tag's comment. */
  commented: boolean;
}

interface Milestone {
  number: number;
  title: string;
  state: string;
  open_issues: number;
}

async function json<T>(result: Promise<GhResult>): Promise<T | undefined> {
  const { code, stdout } = await result;
  if (code !== 0) return undefined;
  try {
    return JSON.parse(stdout) as T;
  } catch {
    return undefined;
  }
}

async function milestoneOf(deps: ReleaseCloseDeps, tag: string): Promise<Milestone | undefined> {
  const list = await json<Milestone[]>(
    deps.gh(["api", `${REPO}/milestones?state=all&per_page=100`]),
  );
  return list?.find((m) => m.title === tag);
}

/** Reads one referenced issue; a pull request or an unreadable number is said and left out. */
async function read(
  deps: ReleaseCloseDeps,
  issue: number,
  comment: string,
): Promise<Planned | "skip" | "unreadable"> {
  const found = await json<{
    title: string;
    state: string;
    pull_request?: unknown;
    milestone: { number: number } | null;
  }>(deps.gh(["api", `${REPO}/issues/${issue}`]));
  if (!found) return "unreadable";
  if (found.pull_request) return "skip";
  const open = found.state === "open";
  const comments = open
    ? await deps.gh(["api", `${REPO}/issues/${issue}/comments`, "--paginate", "--jq", ".[].body"])
    : { code: 0, stdout: "" };
  return {
    issue,
    title: found.title,
    open,
    ...(found.milestone ? { milestone: found.milestone.number } : {}),
    commented: comments.stdout.split("\n").includes(comment),
  };
}

/** Comments and closes one open issue, then boards it; the failures, said by name. */
async function ship(deps: ReleaseCloseDeps, item: Planned, comment: string): Promise<number> {
  const at = `${REPO}/issues/${item.issue}`;
  if (item.open && !item.commented) {
    const posted = await deps.gh(["api", "-X", "POST", `${at}/comments`, "-f", `body=${comment}`]);
    if (posted.code !== 0) {
      deps.log(`#${item.issue}: commenting failed`);
      return 1;
    }
  }
  if (item.open) {
    const closed = await deps.gh([
      "api",
      "-X",
      "PATCH",
      at,
      "-f",
      "state=closed",
      "-f",
      "state_reason=completed",
    ]);
    if (closed.code !== 0) {
      deps.log(`#${item.issue}: closing failed`);
      return 1;
    }
  }
  if (deps.board && !(await deps.board(item.issue))) {
    deps.log(`#${item.issue}: board Done failed`);
    return 1;
  }
  return 0;
}

/** Closes what the tag shipped (with `apply`), or says what it would do; the exit code. */
export async function releaseClose(
  tag: string,
  opts: { apply: boolean; since?: string },
  deps: ReleaseCloseDeps,
): Promise<number> {
  if (!TAG.test(tag) || (opts.since !== undefined && !TAG.test(opts.since))) {
    deps.log("usage: release:close -- vX.Y.Z [--apply] [--since vX.Y.Z]");
    return 2;
  }
  if ((await deps.git(["rev-parse", "--verify", "--quiet", `${tag}^{commit}`])).code !== 0) {
    deps.log(`release:close: no tag ${tag} here (fetch the tags first)`);
    return 2;
  }
  const since =
    opts.since ??
    (
      await deps.git(["describe", "--tags", "--abbrev=0", "--match", "v*", `${tag}^`])
    ).stdout.trim();
  const log = await deps.git(["log", "--format=%s%x1f%b%x1e", `${since}..${tag}`]);
  const refs = issueRefs(log.stdout);
  const comment = `Shipped in ${tag}.`;
  let failures = 0;
  // The issues a merged pull request closes ship with it, even when no commit says so.
  const closes = new Set(refs.closes);
  const merges = await deps.git([
    "log",
    "--first-parent",
    "--merges",
    "--format=%s",
    `${since}..${tag}`,
  ]);
  await inSequence(mergedPulls(merges.stdout), async (pull) => {
    const closing = await deps.gh([
      "pr",
      "view",
      String(pull),
      "--json",
      "closingIssuesReferences",
      "--jq",
      ".closingIssuesReferences[].number",
    ]);
    if (closing.code !== 0) {
      deps.log(`#${pull}: its closing issues cannot be read`);
      failures++;
    } else
      for (const line of closing.stdout.split("\n"))
        if (/^\d+$/.test(line.trim())) closes.add(Number(line));
  });
  deps.log(`release:close ${tag} (${since}..${tag}): ${closes.size} issue(s) to close`);

  const planned: Planned[] = [];
  await inSequence(sorted(closes), async (issue) => {
    const item = await read(deps, issue, comment);
    if (item === "unreadable") {
      deps.log(`#${issue}: cannot be read`);
      failures++;
    } else if (item === "skip") {
      deps.log(`#${issue}: a pull request, skipped`);
    } else {
      planned.push(item);
      const steps = item.open ? [...(item.commented ? [] : ["comment"]), "close"] : [];
      deps.log(
        `#${issue} ${item.open ? "open" : "closed"}: ${plain(item.title)} → ${[...steps, "board Done"].join(", ")}`,
      );
    }
  });
  const only = refs.mentioned.filter((n) => !closes.has(n));
  if (only.length > 0) {
    const left = only.map((n) => `#${n}`).join(", ");
    deps.log(`referenced only, left open: ${left}`);
  }

  const milestone = await milestoneOf(deps, tag);
  if (!opts.apply) {
    if (!milestone) deps.log(`no milestone named ${tag}`);
    else if (milestone.state !== "open") deps.log(`milestone ${tag}: already closed`);
    else {
      const closing = planned.filter((p) => p.open && p.milestone === milestone.number).length;
      const left = Math.max(0, milestone.open_issues - closing);
      deps.log(
        left === 0
          ? `milestone ${tag}: closes once its last open issue is closed`
          : `milestone ${tag}: ${left} open issue(s) left, not closed`,
      );
    }
    deps.log("dry run: nothing changed (--apply to do it)");
    return failures > 0 ? 1 : 0;
  }

  if (!deps.board) deps.log("board skipped (no board command: set FLIGHTDECK_BOARD_CMD)");
  await inSequence(planned, async (item) => {
    failures += await ship(deps, item, comment);
  });

  const after = milestone ? await milestoneOf(deps, tag) : undefined;
  if (!after) deps.log(`no milestone named ${tag}`);
  else if (after.state !== "open") deps.log(`milestone ${tag}: already closed`);
  else if (failures > 0) deps.log(`milestone ${tag}: left open, a step above failed`);
  else if (after.open_issues > 0) {
    deps.log(`milestone ${tag}: ${after.open_issues} open issue(s) left, not closed`);
  } else {
    const closed = await deps.gh([
      "api",
      "-X",
      "PATCH",
      `${REPO}/milestones/${after.number}`,
      "-f",
      "state=closed",
    ]);
    if (closed.code !== 0) {
      deps.log(`milestone ${tag}: closing failed`);
      failures++;
    } else deps.log(`milestone ${tag}: closed`);
  }
  return failures > 0 ? 1 : 0;
}
