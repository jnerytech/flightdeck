/**
 * The push-wait rule (#741): a push that would cancel a PR run still green is held. It reads the
 * branch's latest PR run through gh and decides; the guard hook wires the gh calls, and
 * `pr update` asks the same pass rule.
 */
import { heavyReasonGiven } from "../slot/heavy.ts";
import type { PushGuardDeps } from "./push-rules.ts";
import { pushedBranches } from "./push-rules.ts";
import { printable, redacted } from "./redact.ts";
import type { GitCall } from "./shell-parse.ts";
import { gitCalls, prefixAssignment } from "./shell-parse.ts";

/** The latest pull-request CI run of a branch, as the push-wait rule reads it (#741). */
export interface PrRun {
  id: number;
  /** The run's page on GitHub. */
  url: string;
  inProgress: boolean;
  /** A check of the PR has failed already (#756 review: then the push is a fix). */
  failed: boolean;
  /** The PR conflicts with its base (#756 review: the merge of main must go out). */
  conflicting: boolean;
  /** Minutes since the run started. */
  minutes: number;
  /** #1541: the PR's auto-merge is off, so the run decides nothing; absent when on or unknown. */
  autoMergeOff?: boolean;
}

/** A branch's latest PR run, "none" when it has none, null when GitHub cannot be read. */
export type PrRunAnswer = PrRun | "none" | null;

export interface PushWaitDeps extends PushGuardDeps {
  /** The branch's latest PR run, read in `dir`: "none" when it has none, null when GitHub cannot be read. */
  prRun: (branch: string, dir: string) => PrRunAnswer;
  /** Why no lookup could answer (gh missing, no time left), which lets the push go; null holds it. */
  whyUnread?: () => string | null;
}

/** Why push-wait let a push through to one branch (#741: logged, so the passes can be read). */
export interface PushWaitPass {
  reason: string;
  /** The age of an old run. */
  minutes?: number;
}

/**
 * A branch's latest PR run from `gh run list --json databaseId,status,startedAt,url`, with its PR's
 * conflict and failed checks from `gh pr view --json mergeable,statusCheckRollup`: "none" when
 * the list is empty, null when the list is missing or does not read (#741: GitHub unread); a PR
 * unread leaves the run's age to decide (#945 review).
 */
export function prRunFrom(runs: string | null, pr: string | null, now: number): PrRunAnswer {
  try {
    const list = JSON.parse(runs ?? "") as Array<Record<string, unknown>>;
    if (Array.isArray(list) && list.length === 0) return "none";
    const latest = list[0];
    if (!latest || typeof latest.databaseId !== "number") return null;
    const started = Date.parse(String(latest.startedAt));
    if (Number.isNaN(started)) return null;
    const view = parsedView(pr);
    return {
      id: latest.databaseId,
      url: typeof latest.url === "string" ? latest.url : "",
      inProgress: latest.status !== "completed",
      failed: (view.statusCheckRollup ?? []).some((check) =>
        FAILED_CHECK.has(check.conclusion ?? check.state ?? ""),
      ),
      conflicting: view.mergeable === "CONFLICTING",
      minutes: Math.floor((now - started) / 60_000),
      // Only a PR read with the field and none set: an unread PR is not known to be off.
      // A merged or closed PR's null says nothing (#1560 review): only an open one counts.
      ...(view.state === "OPEN" && "autoMergeRequest" in view && view.autoMergeRequest === null
        ? { autoMergeOff: true }
        : {}),
    };
  } catch {
    return null;
  }
}

/**
 * The PR's mergeable state and checks, or none known when `gh pr view` failed or printed no JSON:
 * the run's age decides then (#945 review), so a PR unread alone never holds a push.
 */
function parsedView(text: string | null): {
  mergeable?: string;
  autoMergeRequest?: unknown;
  state?: string;
  statusCheckRollup?: Array<{ conclusion?: string; state?: string }>;
} {
  try {
    return JSON.parse(text ?? "") ?? {};
  } catch {
    return {};
  }
}

/** Runs gh with these arguments in a folder; its output, or null when it fails. */
export type Gh = (args: string[], dir: string) => string | null;

/**
 * The guard's reader of a branch's latest PR run (#756 review: the gh calls are tested here, not
 * left as glue): `gh run list`, then `gh pr view` only when there is a run.
 */
export function prRunVia(gh: Gh, now: () => number): (branch: string, dir: string) => PrRunAnswer {
  return (branch, dir) => {
    // The branch goes as one `--branch=` word, so no name reads as a flag.
    const runs = gh(
      [
        "run",
        "list",
        `--branch=${branch}`,
        "--event=pull_request",
        "--limit=1",
        "--json=databaseId,status,startedAt,url",
      ],
      dir,
    );
    if (runs === null) return null;
    if (runs.trim() === "[]") return "none";
    // `--` ends the flags, so the branch is always the PR to view.
    const pr = gh(
      ["pr", "view", "--json=mergeable,statusCheckRollup,autoMergeRequest,state", "--", branch],
      dir,
    );
    return prRunFrom(runs, pr, now());
  };
}

/** The check conclusions (a check run's) and states (a commit status's) that mean it failed. */
const FAILED_CHECK = new Set([
  "FAILURE",
  "TIMED_OUT",
  "STARTUP_FAILURE",
  "ACTION_REQUIRED",
  "ERROR",
]);

/** How young a green PR run must be for a push to wait for it (#741). */
const PUSH_WAIT_MINUTES = 20;

/**
 * Why a push would cancel a PR run that is still green (#741), or null. A new push cancels the
 * branch's run in progress (`cancel-in-progress`); 10% of the PR runner-minutes went to runs a push
 * cancelled while still green. A PR with a failed check or a conflict (the push is a fix), an
 * ended or older run, no run, a release-v* branch, the coordinator and
 * `FLIGHTDECK_PUSH_NOW="<reason>"` in front of the push pass. When GitHub cannot be read, twice,
 * the push holds too, with the same override line: a silent pass let green runs be cancelled.
 */
export function pushWaitViolation(command: string, cwd: string, deps: PushWaitDeps): string | null {
  return pushWaitCheck(command, cwd, deps).violation;
}

/**
 * The push-wait decision of a command (#741): the refusal, or, for each pushed branch the rule
 * looked at and let go, why. A delete, a release-v* branch, an override and the coordinator are
 * not looked at, so they log no pass.
 */
export function pushWaitCheck(
  command: string,
  cwd: string,
  deps: PushWaitDeps,
): { violation: string | null; passes: PushWaitPass[] } {
  const passes: PushWaitPass[] = [];
  if (deps.env.FLIGHTDECK_COORDINATOR) return { violation: null, passes };
  for (const call of gitCalls(command, cwd)) {
    const push = pushToCheck(call, command, deps);
    if (push === null) continue;
    const { dir, override } = push;
    for (const branch of pushedBranches(call, (args) => deps.git(args, dir))) {
      const verdict = branchVerdict(branch, dir, override, deps);
      if ("violation" in verdict) return { violation: verdict.violation, passes };
      passes.push(verdict.pass);
    }
  }
  return { violation: null, passes };
}

/**
 * The folder and the override line of a push the rule looks at (#741), or null for any other git
 * call, a push outside the project and a push that carries `FLIGHTDECK_PUSH_NOW="<reason>"`.
 */
function pushToCheck(
  call: GitCall,
  command: string,
  deps: PushWaitDeps,
): { dir: string; override: string } | null {
  if (call.sub !== "push" || call.dir === null) return null;
  if (deps.inProject && !deps.inProject(call.dir)) return null;
  const segment = command.slice(call.start, call.end);
  if (heavyReasonGiven(prefixAssignment(segment, "FLIGHTDECK_PUSH_NOW"))) return null;
  // Unprintable characters out first, so none reaches the terminal or splits a secret (#945 review).
  const override = `FLIGHTDECK_PUSH_NOW="<reason>" ${redacted(printable(segment.trim()))}`;
  return { dir: call.dir, override };
}

/** Whether one pushed branch holds the push (the refusal) or goes (why), #741. */
function branchVerdict(
  branch: string,
  dir: string,
  override: string,
  deps: PushWaitDeps,
): { violation: string } | { pass: PushWaitPass } {
  // The name comes from the command or from git: unprintable characters out first (so none splits a secret), then secrets hidden (#945 review).
  const shown = redacted(printable(branch));
  // A reason an earlier branch's lookups left is not this branch's (#945 security review).
  deps.whyUnread?.();
  // One more try: a gh call can time out once on a busy machine.
  const run = deps.prRun(branch, dir) ?? deps.prRun(branch, dir);
  if (run === null) {
    // No lookup could answer (gh missing, no time left): retrying would not help, so it goes,
    // logged with why (#945 review). GitHub that answered with a failure holds.
    const why = deps.whyUnread?.() ?? null;
    if (why) return { pass: { reason: why } };
    return {
      violation: `GitHub could not be read to check the PR run of ${shown}, twice (#741). Push again in a minute, or push now with:\n  ${override}`,
    };
  }
  if (run === "none") return { pass: { reason: "no run" } };
  const pass = pushWaitPass(run);
  if (pass) return { pass };
  // Only GitHub's own https address; the echoed push hides credentials (security review).
  const url = /^https:\/\/[!-~]+$/.test(run.url) ? `: ${run.url}` : "";
  return {
    violation: `a push now cancels CI run ${run.id} on the PR of ${shown}, ${run.minutes} min old with no failed check (#741)${url}. Batch the next commits with this one and push once the run ends, or push now with:\n  ${override}`,
  };
}

/**
 * Why a push may go past this run, or null when it would cancel it while young and green; `pr
 * update` asks it too (#741).
 */
export function pushWaitPass(run: PrRun): PushWaitPass | null {
  // A failed check or a conflict makes the push a fix that must go out (#756 review).
  if (run.failed) return { reason: "failed check" };
  if (run.conflicting) return { reason: "conflicts" };
  // #1541: with auto-merge off the run merges nothing; every such block of a day was overridden.
  if (run.autoMergeOff) return { reason: "auto-merge off" };
  if (!run.inProgress) return { reason: "run ended" };
  if (run.minutes >= PUSH_WAIT_MINUTES) return { reason: "old run", minutes: run.minutes };
  return null;
}

/** The guard's gh for push-wait (#945 review): calls start only before `limit`; why nothing answered. */
export function budgetedGh(
  spawn: (args: string[], dir: string) => { stdout: string | null; missing: boolean },
  exists: (dir: string) => boolean,
  now: () => number,
  limit: number,
): { gh: Gh; whyUnread: () => string | null } {
  let why: string | null = null;
  return {
    gh: (args, dir) => {
      if (now() > limit) {
        why ??= "no time";
        return null;
      }
      const ran = spawn(args, dir);
      // spawn says ENOENT for a folder that does not exist too: only an existing one means gh is
      // missing (#945 security review: `cd nowhere; git push` must not pass).
      if (ran.missing && exists(dir)) why ??= "gh missing";
      return ran.stdout;
    },
    // Read once: the next branch's lookups start with no reason left over (#945 security review).
    whyUnread: () => {
      const said = why;
      why = null;
      return said;
    },
  };
}

/**
 * `fn`, made only while `now()` is at or before `limit` (#826 review); past it, null with no call.
 * The guard wraps its gh and git calls so each starts early enough to end inside the hook's 10 s.
 */
export function withBudget<A extends unknown[], R>(
  fn: (...args: A) => R | null,
  now: () => number,
  limit: number,
): (...args: A) => R | null {
  return (...args) => (now() > limit ? null : fn(...args));
}

/**
 * A push that goes ahead on a FLIGHTDECK_PUSH_NOW override (#741), or null: its reason, with
 * secrets hidden and cut at 200 characters, and, given the push's folder and deps, the age of the
 * pushed branch's PR run (#741: logged so the overrides can be read). The log counts every such
 * push, also one the rule would have let through: harness:stats shows an upper bound.
 */
export function pushNowOverride(
  command: string,
  push?: { cwd: string; deps: PushWaitDeps },
): { detail: string; minutes?: number } | null {
  for (const call of gitCalls(command, push?.cwd ?? "/")) {
    if (call.sub !== "push") continue;
    const reason = prefixAssignment(command.slice(call.start, call.end), "FLIGHTDECK_PUSH_NOW");
    if (!heavyReasonGiven(reason)) continue;
    const dir = call.dir;
    // A checkout outside the project is not the rule's: no waiver, and gh is not asked there. A
    // folder the parse cannot tell (dir null) still logs the reason alone: an upper bound.
    if (dir !== null && push?.deps.inProject && !push.deps.inProject(dir)) continue;
    // Unprintable characters go first, so none reaches the terminal and none splits a secret.
    // Cut before the redaction too, so its regexes never scan an unbounded reason; the last cut
    // counts characters, never splitting one in two.
    const detail = Array.from(
      redacted(
        printable(reason ?? "")
          .trim()
          .slice(0, 2000),
      ),
    )
      .slice(0, 200)
      .join("");
    if (!push || dir === null) return { detail };
    const ages = pushedBranches(call, (args) => push.deps.git(args, dir)).flatMap((branch) => {
      const run = push.deps.prRun(branch, dir);
      return run && run !== "none" && run.inProgress ? [run.minutes] : [];
    });
    return ages.length > 0 ? { detail, minutes: Math.min(...ages) } : { detail };
  }
  return null;
}
