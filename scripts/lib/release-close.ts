/**
 * `bun run release:close -- <tag> [--apply] [--since <tag>]` (issue #252): after a release tag, the
 * issues its commits reference get "Shipped in <tag>", are closed and go to Done on the board, and
 * the milestone named after the tag is closed once nothing in it is open. A dry run by default; an
 * issue the tag's commits do not reference is never touched, and a second run repeats nothing.
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
/** A body line that names the issue: `Closes #12`, `fixes #12`, `Resolves #12`, `Refs: #12` (#253). */
const CLOSING_LINE = /^\s*(?:closes|fixes|resolves|refs):?\s+#(\d+)/i;

const numbers = (text: string) => [...text.matchAll(/#(\d+)\b/g)].map((m) => Number(m[1]));
const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);

/** The issues a tag's commits reference: in a subject, or a `Closes/Fixes/Resolves #N` body line. */
export function issueRefs(log: string): { closes: number[]; mentioned: number[] } {
  const closes = new Set<number>();
  const inBodies = new Set<number>();
  for (const record of log.split("\x1e")) {
    const [subject = "", body = ""] = record.replace(/^\n/, "").split("\x1f");
    for (const n of numbers(subject)) closes.add(n);
    for (const line of body.split("\n")) {
      const closing = CLOSING_LINE.exec(line);
      if (closing) closes.add(Number(closing[1]));
      for (const n of numbers(line)) inBodies.add(n);
    }
  }
  const mentioned = new Set([...inBodies].filter((n) => !closes.has(n)));
  return { closes: sorted(closes), mentioned: sorted(mentioned) };
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
  deps.log(`release:close ${tag} (${since}..${tag}): ${refs.closes.length} referenced number(s)`);

  let failures = 0;
  const planned: Planned[] = [];
  for (const issue of refs.closes) {
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
        `#${issue} ${item.open ? "open" : "closed"}: ${item.title} → ${[...steps, "board Done"].join(", ")}`,
      );
    }
  }
  if (refs.mentioned.length > 0) {
    const list = refs.mentioned.map((n) => `#${n}`).join(", ");
    deps.log(`mentioned only in commit bodies, not touched: ${list}`);
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
  for (const item of planned) failures += await ship(deps, item, comment);

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
