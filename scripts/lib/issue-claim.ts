/**
 * Issue #1410: a session claims an issue before it starts, and a claim by another session is
 * refused. Every issue's assignee is the same account, so the owner lives in a hidden marker of the
 * issue's comments, written by `issue-note.sh` and by `bun run claim`:
 * `<!-- flightdeck-owner: <session> status: <progress|reassign|ready|done|todo> -->`.
 * It is a collaboration guard, not access control: the session names are self-declared and anyone
 * who can comment can write a marker, so it only changes who the tool says owns an issue.
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

/** The marker as the last line of a comment: a marker quoted in a reply is no marker. */
const MARK =
  /(?:^|\n)<!-- flightdeck-owner: (\w[\w.-]{0,31}) status: (progress|reassign|ready|done|todo) -->\s*$/;
/** A session name: a word character first, so a flag can never be one. */
const SESSION = /^\w[\w.-]{0,31}$/;
const COORDINATOR = "fd-coordinator";
const USAGE = "usage: bun run claim <issue> [--by <session>] [--reassign | --release]";

/** The marker line for a comment. */
export function ownerMark(owner: string, status: ClaimStatus): string {
  return `<!-- flightdeck-owner: ${owner} status: ${status} -->`;
}

/** The markers of an issue's comments, in time order; a comment without one gives none. */
export function marksOf(comments: Array<{ body: string; createdAt: string }>): OwnerMark[] {
  return [...comments]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .flatMap(({ body, createdAt }) => {
      const m = MARK.exec(body);
      return m ? [{ owner: m[1] as string, status: m[2] as ClaimStatus, at: createdAt }] : [];
    });
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

/** gh's answer as JSON, or null when it is not. */
function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The issue's state and owner, read from GitHub over every page of comments; throws when gh cannot say. */
async function read(
  deps: ClaimDeps,
  issue: number,
): Promise<{ open: boolean; owner: string | null }> {
  const failed = (why: string) =>
    new Error(`gh could not read #${issue}: ${why.trim() || "not JSON"}`);
  const viewed = await deps.gh(["issue", "view", String(issue), "--json", "state"]);
  const state = (json(viewed.code === 0 ? viewed.stdout : "") as { state?: unknown } | null)?.state;
  if (state !== "OPEN" && state !== "CLOSED") throw failed(viewed.stderr ?? "");
  // gh issue view lists at most 100 comments on older gh: page through them all.
  const listed = await deps.gh([
    "api",
    "--paginate",
    `repos/{owner}/{repo}/issues/${issue}/comments`,
    "--jq",
    ".[] | {body: .body, createdAt: .created_at}",
  ]);
  if (listed.code !== 0) throw failed(listed.stderr ?? "");
  const comments: Array<{ body: string; createdAt: string }> = [];
  for (const line of listed.stdout.split("\n").filter((l) => l.trim() !== "")) {
    const c = json(line) as { body?: unknown; createdAt?: unknown } | null;
    if (typeof c?.body !== "string" || typeof c.createdAt !== "string") throw failed("");
    comments.push({ body: c.body, createdAt: c.createdAt });
  }
  return { open: state === "OPEN", owner: currentOwner(marksOf(comments)) };
}

const ownedBy = (issue: number, owner: string) =>
  `#${issue} is owned by ${owner}: ask fd-coordinator to reassign it (bun run claim ${issue} --by <session> --reassign)`;

/** Posts a marker comment; false (and a line) when gh refuses. */
async function post(deps: ClaimDeps, issue: number, text: string, mark: string): Promise<boolean> {
  const posted = await deps.gh(["issue", "comment", String(issue), "--body", `${text}\n\n${mark}`]);
  if (posted.code === 0) return true;
  deps.log(`claim: gh could not comment on #${issue}: ${(posted.stderr ?? "").trim()}`);
  return false;
}

/** Releases the issue: only its owner or the coordinator does. */
async function release(deps: ClaimDeps, issue: number, session: string, owner: string | null) {
  if (owner === null) {
    deps.log(`#${issue} is not claimed`);
    return 0;
  }
  if (owner !== session && !deps.coordinator) {
    deps.log(ownedBy(issue, owner));
    return 1;
  }
  // The coordinator releases in its own name: only the owner's or fd-coordinator's release counts.
  const by = owner === session ? session : COORDINATOR;
  if (!(await post(deps, issue, `${by} releases this issue.`, ownerMark(by, "todo")))) return 1;
  deps.log(`released #${issue} (${by})`);
  return 0;
}

type ClaimRequest = { issue: number; session: string; reassign: boolean; release: boolean };

/** The words of a `claim` call checked: the request, or the exit code of a refusal (already logged). */
function parseRequest(args: string[], deps: ClaimDeps): ClaimRequest | number {
  const words = args.filter((a) => a !== "--");
  const issue = /^\d+$/.test(words[0] ?? "") ? Number(words[0]) : 0;
  const by = words.indexOf("--by");
  const session = by === -1 ? deps.session : words[by + 1];
  // Every word is the issue, --by and its session, --reassign or --release: a typo never claims.
  const known = words.every(
    (w, i) => i === 0 || w === "--reassign" || w === "--release" || w === "--by" || i === by + 1,
  );
  if (issue <= 0 || !session || !SESSION.test(session) || !known || (by !== -1 && by < 1)) {
    deps.log(USAGE);
    return 2;
  }
  // fd-coordinator's marks release any issue: only its own session may write them.
  if (session === COORDINATOR && !deps.coordinator) {
    deps.log("only fd-coordinator's own session acts as fd-coordinator");
    return 1;
  }
  const reassign = words.includes("--reassign");
  const release = words.includes("--release");
  if (reassign && release) {
    deps.log(USAGE);
    return 2;
  }
  if (reassign && !deps.coordinator) {
    deps.log("only fd-coordinator reassigns an issue");
    return 1;
  }
  return { issue, session, reassign, release };
}

/** Takes an issue: refused when it is closed or another session owns it, and the first of two claims at once stands. */
async function take(
  deps: ClaimDeps,
  request: ClaimRequest,
  before: { open: boolean; owner: string | null },
): Promise<number> {
  const { issue, session, reassign } = request;
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
  if (!(await post(deps, issue, text, ownerMark(session, status)))) return 1;
  // Two sessions can claim at the same moment: read again, and only the first claim stands.
  const after = await read(deps, issue);
  if (after.owner !== session) {
    deps.log(ownedBy(issue, after.owner ?? "nobody"));
    return 1;
  }
  deps.log(reassign ? `reassigned #${issue} to ${session}` : `claimed #${issue} for ${session}`);
  return 0;
}

/** `claim <n> [--by <session>] [--reassign | --release]`; the exit code. */
export async function claimIssue(args: string[], deps: ClaimDeps): Promise<number> {
  const request = parseRequest(args, deps);
  if (typeof request === "number") return request;
  try {
    const before = await read(deps, request.issue);
    if (request.release) return await release(deps, request.issue, request.session, before.owner);
    return await take(deps, request, before);
  } catch (error) {
    deps.log(`claim: ${(error as Error).message}`);
    return 1;
  }
}
