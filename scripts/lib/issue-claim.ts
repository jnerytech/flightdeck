/**
 * Issue #1410: a session claims an issue before it starts, and a claim by another session is
 * refused. Every issue's assignee is the same account, so the owner lives in a hidden marker of the
 * issue's comments, written by `issue-note.sh` and by `bun run claim`:
 * `<!-- flightdeck-owner: <session> status: <progress|reassign|ready|done|todo> -->`.
 */
import type { GhResult } from "./ci-branch.ts";

export type ClaimStatus = "progress" | "reassign" | "ready" | "done" | "todo";

/** One marker read back from a comment, in the order GitHub lists them. */
export interface OwnerMark {
  owner: string;
  status: ClaimStatus;
  at: string;
}

export interface ClaimDeps {
  /** Runs `gh <args>` in the repository. */
  gh(args: string[]): Promise<GhResult>;
  log(line: string): void;
  /** The session from FLIGHTDECK_SESSION, when set. */
  session?: string;
  /** FLIGHTDECK_COORDINATOR=1: the only session that may reassign. */
  coordinator: boolean;
}

const MARK =
  /<!-- flightdeck-owner: ([\w.-]{1,32}) status: (progress|reassign|ready|done|todo) -->/g;
const COORDINATOR = "fd-coordinator";
const USAGE = "usage: bun run claim <issue> [--by <session>] [--reassign]";

/** The marker line for a comment. */
export function ownerMark(owner: string, status: ClaimStatus): string {
  return `<!-- flightdeck-owner: ${owner} status: ${status} -->`;
}

/** The markers of an issue's comments, oldest first; a comment without one gives none. */
export function marksOf(comments: Array<{ body: string; createdAt: string }>): OwnerMark[] {
  return comments.flatMap(({ body, createdAt }) =>
    [...body.matchAll(MARK)].map((m) => ({
      owner: m[1] as string,
      status: m[2] as ClaimStatus,
      at: createdAt,
    })),
  );
}

/**
 * Who owns the issue after these marks, or null when it is free. The first claim since the last
 * release owns it, so of two claims at the same moment only the first stands; the coordinator hands
 * it over with `reassign`; the owner or the coordinator releases it with ready, done or todo.
 */
export function currentOwner(marks: OwnerMark[]): string | null {
  let owner: string | null = null;
  for (const { owner: who, status } of marks) {
    if (status === "reassign") owner = who;
    else if (status === "progress") owner ??= who;
    else if (who === owner || who === COORDINATOR) owner = null;
  }
  return owner;
}

/** The issue's state and owner, read from GitHub; throws when gh cannot say. */
async function read(
  deps: ClaimDeps,
  issue: number,
): Promise<{ open: boolean; owner: string | null }> {
  const viewed = await deps.gh(["issue", "view", String(issue), "--json", "state,comments"]);
  let answer: { state?: string; comments?: Array<{ body: string; createdAt: string }> } | null =
    null;
  try {
    answer = viewed.code === 0 ? JSON.parse(viewed.stdout) : null;
  } catch {
    answer = null;
  }
  if (!answer || !Array.isArray(answer.comments)) {
    throw new Error(`gh could not read #${issue}: ${(viewed.stderr ?? "").trim() || "not JSON"}`);
  }
  return { open: answer.state !== "CLOSED", owner: currentOwner(marksOf(answer.comments)) };
}

const ownedBy = (issue: number, owner: string) =>
  `#${issue} is owned by ${owner}: ask fd-coordinator to reassign it (bun run claim ${issue} --by <session> --reassign)`;

/** `claim <n> [--by <session>] [--reassign]`; the exit code. */
export async function claimIssue(args: string[], deps: ClaimDeps): Promise<number> {
  const words = args.filter((a) => a !== "--");
  const issue = Number(words[0]);
  const by = words.indexOf("--by");
  const session = by === -1 ? deps.session : words[by + 1];
  if (!Number.isInteger(issue) || issue <= 0 || !session || !/^[\w.-]{1,32}$/.test(session)) {
    deps.log(USAGE);
    return 2;
  }
  const reassign = words.includes("--reassign");
  if (reassign && !deps.coordinator) {
    deps.log("only fd-coordinator reassigns an issue");
    return 1;
  }
  try {
    const before = await read(deps, issue);
    if (!before.open) {
      deps.log(`#${issue} is closed: there is nothing to claim`);
      return 1;
    }
    if (!reassign && before.owner === session) {
      deps.log(`#${issue} is already yours (${session})`);
      return 0;
    }
    if (!reassign && before.owner) {
      deps.log(ownedBy(issue, before.owner));
      return 1;
    }
    const status: ClaimStatus = reassign ? "reassign" : "progress";
    const text = reassign
      ? `${session} owns this issue now (reassigned).`
      : `${session} claims this issue.`;
    const posted = await deps.gh([
      "issue",
      "comment",
      String(issue),
      "--body",
      `${text}\n\n${ownerMark(session, status)}`,
    ]);
    if (posted.code !== 0) {
      deps.log(`claim: gh could not comment on #${issue}: ${(posted.stderr ?? "").trim()}`);
      return 1;
    }
    // Two sessions can claim at the same moment: read again, and only the first claim stands.
    const after = await read(deps, issue);
    if (after.owner !== session) {
      deps.log(ownedBy(issue, after.owner ?? "nobody"));
      return 1;
    }
    deps.log(reassign ? `reassigned #${issue} to ${session}` : `claimed #${issue} for ${session}`);
    return 0;
  } catch (error) {
    deps.log(`claim: ${(error as Error).message}`);
    return 1;
  }
}
