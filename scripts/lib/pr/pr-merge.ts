import { inSequence } from "@flightdeck/protocol";
import { type PrRun, prRunFrom, pushWaitPass } from "../hooks/claude-hooks.ts";
import { heavyReasonGiven } from "../slot/heavy.ts";
import {
  aheadBy,
  behindBy,
  checksProblem,
  conflictProblem,
  conflictText,
  jsonLines,
  requiredChecks,
} from "./pr-checks.ts";
import { warnMainRed } from "./pr-open.ts";
import { MAIN, type Pr, type PrFlowDeps, REPO } from "./pr-types.ts";

/*
 * `bun run pr -- <next|update|auto|merge> …` (issues #260, #271, #374): the commands that move an
 * open PR toward main. `next` lists the PRs in the order to merge, `update` brings one up to date
 * with its base, `auto` turns on GitHub's auto-merge, and `merge` (the coordinator only) merges.
 */

/** The order to merge: PRs onto main by number, each stacked PR right after the PR it sits on. */
export function mergeOrder(prs: Pr[]): Pr[] {
  const byNumber = [...prs].sort((a, b) => a.number - b.number);
  const heads = new Set(prs.map((p) => p.head));
  const order: Pr[] = [];
  const visit = (pr: Pr) => {
    order.push(pr);
    for (const child of byNumber.filter((p) => p.base === pr.head)) visit(child);
  };
  for (const root of byNumber.filter((p) => !heads.has(p.base))) visit(root);
  return order;
}

export async function nextPrs(deps: PrFlowDeps): Promise<number> {
  const required = await requiredChecks(deps);
  if (!required) {
    deps.log(`the ${MAIN} ruleset's required checks cannot be read`);
    return 1;
  }
  const listed = await deps.gh([
    "api",
    "--paginate",
    `${REPO}/pulls?state=open&per_page=100`,
    "--jq",
    ".[] | {number, head: .head.ref, sha: .head.sha, base: .base.ref, draft, title}",
  ]);
  const prs = jsonLines<Pr>(listed.stdout);
  if (prs.length === 0) {
    deps.log("no open PR");
    return 0;
  }
  const ready: string[] = [];
  const waiting: string[] = [];
  await inSequence(mergeOrder(prs), async (pr) => {
    const parent = prs.find((p) => p.head === pr.base);
    let reason: string | null = null;
    if (parent) reason = `waits for #${parent.number} (${parent.head})`;
    else if (pr.draft) reason = "a draft";
    else reason = await checksProblem(deps, pr.sha, required);
    // Behind its base is no reason to wait (the ruleset is not strict, #305); a conflict is.
    if (!reason) reason = await conflictProblem(deps, pr.number, pr.base, pr.head);
    if (reason) waiting.push(`  #${pr.number} ${pr.head}: ${reason}`);
    else ready.push(`  #${pr.number} ${pr.head}`);
  });
  if (ready.length > 0) deps.log("ready to merge, in order:");
  for (const line of ready) deps.log(line);
  if (waiting.length > 0) deps.log("not ready:");
  for (const line of waiting) deps.log(line);
  return 0;
}

/**
 * Why `update` must wait (#741), or null. GitHub's update-branch makes a new head, which cancels
 * the PR's run in progress like a push does, and the guard hook never sees it. The same rule as
 * push-wait: a young green run holds it; GitHub unread twice holds it too; the coordinator and
 * `FLIGHTDECK_PUSH_NOW="<reason>"` go.
 */
async function updateWait(n: number, deps: PrFlowDeps): Promise<string | null> {
  if (deps.env.FLIGHTDECK_COORDINATOR || heavyReasonGiven(deps.env.FLIGHTDECK_PUSH_NOW))
    return null;
  const override = `FLIGHTDECK_PUSH_NOW="<reason>" bun run pr -- update ${n}`;
  const read = await deps.gh(["api", `${REPO}/pulls/${n}`]);
  const pr = read.code === 0 ? parsedPr(read.stdout) : null;
  const head = pr?.head?.ref;
  // A fork's branch name may match another branch here, whose run is not its own (#952 review).
  const headRepo = pr?.head?.repo;
  if (headRepo === null || (headRepo && headRepo.full_name !== pr?.base?.repo?.full_name)) {
    return `#${n} comes from a fork: its PR run cannot be told from a branch of the same name here (#741). Update it with:\n  ${override}`;
  }
  const lookup = async (): Promise<PrRun | "none" | null> => {
    if (!head) return null;
    // The branch goes as one `--branch=` word, so no name reads as a flag.
    const runs = await deps.gh([
      "run",
      "list",
      `--branch=${head}`,
      "--event=pull_request",
      "--limit=1",
      "--json=databaseId,status,startedAt,url",
    ]);
    if (runs.code !== 0) return null;
    if (runs.stdout.trim() === "[]") return "none";
    const view = await deps.gh(["pr", "view", String(n), "--json=mergeable,statusCheckRollup"]);
    return prRunFrom(runs.stdout, view.code === 0 ? view.stdout : null, (deps.now ?? Date.now)());
  };
  // One more try: a gh call can fail once on a busy machine.
  const run = (await lookup()) ?? (await lookup());
  if (run === null) {
    return `#${n}: GitHub could not be read to check its PR run, twice (#741). Try again in a minute, or update now with:\n  ${override}`;
  }
  if (run === "none" || pushWaitPass(run)) return null;
  const url = /^https:\/\/[!-~]+$/.test(run.url) ? `: ${run.url}` : "";
  return `#${n}: updating now cancels CI run ${run.id}, ${run.minutes} min old with no failed check (#741)${url}. A PR behind main merges anyway (#305): wait for the run to end, or update now with:\n  ${override}`;
}

/** The parts of a PR read that `update` needs, or null when GitHub's answer is not JSON. */
function parsedPr(text: string): {
  head?: { ref?: string; repo?: { full_name?: string } | null };
  base?: { repo?: { full_name?: string } };
} | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Brings a PR up to date with its base, then turns its auto-merge back on (#613): GitHub turns it
 * off when the PR conflicts, and nothing turned it back on after the merge. A draft, or a PR onto a
 * parent main does not have yet, stays updated without it, which is no failure.
 */
export async function updatePr(n: number, deps: PrFlowDeps): Promise<number> {
  await warnMainRed(deps);
  const held = await updateWait(n, deps);
  if (held) {
    deps.log(held);
    return 1;
  }
  const { code } = await deps.gh(["api", "-X", "PUT", `${REPO}/pulls/${n}/update-branch`]);
  deps.log(code === 0 ? `#${n} updated with its base` : `GitHub refused to update #${n}`);
  if (code !== 0) return 1;
  return (await autoPr(n, deps)) === 1 ? 1 : 0;
}

/** Turns on GitHub's auto-merge for a PR onto main: it merges by itself once its checks are green. */
export async function autoPr(n: number, deps: PrFlowDeps): Promise<number> {
  const read = await deps.gh(["api", `${REPO}/pulls/${n}`]);
  if (read.code !== 0) {
    deps.log(`#${n} cannot be read`);
    return 1;
  }
  const pr = JSON.parse(read.stdout) as { node_id: string; draft: boolean; base: { ref: string } };
  let reason: string | null = null;
  if (pr.draft) reason = "a draft: mark it ready first";
  else if (pr.base.ref !== MAIN) {
    const ahead = await aheadBy(deps, MAIN, pr.base.ref);
    if (ahead === null) reason = `GitHub cannot compare ${pr.base.ref} with ${MAIN}`;
    else if (ahead > 0) {
      reason = `onto ${pr.base.ref}, which ${MAIN} does not have yet: run it again once its parent merges`;
    }
  }
  if (reason) {
    deps.log(`#${n}: auto-merge not turned on: ${reason}`);
    return 2;
  }
  // The parent merged and its branch stays (no delete on merge): the PR goes onto main itself.
  if (pr.base.ref !== MAIN) {
    const moved = await deps.gh(["api", "-X", "PATCH", `${REPO}/pulls/${n}`, "-f", `base=${MAIN}`]);
    if (moved.code !== 0) {
      deps.log(`GitHub refused to retarget #${n} onto ${MAIN}`);
      return 1;
    }
    deps.log(`#${n} retargeted from ${pr.base.ref} onto ${MAIN}`);
  }
  const enabled = await deps.gh([
    "api",
    "-X",
    "POST",
    "graphql",
    "-f",
    "query=mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: MERGE }) { clientMutationId } }",
    "-f",
    `id=${pr.node_id}`,
  ]);
  if (enabled.code !== 0) {
    const error = graphqlError(enabled.stdout);
    deps.log(`GitHub refused auto-merge for #${n}${error}`);
    // GitHub turns auto-merge on only for a PR that has to wait (#374): one already clean merges
    // now, as auto-merge would, under the same checks; any other refusal stays a failure.
    if (/clean status/i.test(error)) {
      deps.log(`#${n} is already mergeable: merging it as auto-merge would`);
      return mergeChecked(n, deps, true);
    }
    return 1;
  }
  deps.log(`#${n} merges by itself, with a merge commit, once its required checks are green`);
  return 0;
}

/** The first error GitHub's GraphQL gave, as ": <message>", or nothing. */
function graphqlError(stdout: string): string {
  try {
    const message = (JSON.parse(stdout) as { errors?: { message?: string }[] }).errors?.[0]
      ?.message;
    return message ? `: ${message}` : "";
  } catch {
    return "";
  }
}

export async function mergePr(n: number, deps: PrFlowDeps): Promise<number> {
  if (deps.env.FLIGHTDECK_COORDINATOR !== "1") {
    deps.log("merging is the coordinator's (FLIGHTDECK_COORDINATOR=1)");
    return 2;
  }
  return mergeChecked(n, deps, false);
}

/**
 * Merges a PR onto main with a merge commit, pinned to the head whose checks were read, only when
 * every required check of the ruleset is green there. `cleanOnly` (`auto`, #374) also needs GitHub's
 * state to be exactly clean, the state auto-merge waits for; a hand merge lets a PR behind main
 * through (#305).
 */
async function mergeChecked(n: number, deps: PrFlowDeps, cleanOnly: boolean): Promise<number> {
  const required = await requiredChecks(deps);
  if (!required) {
    deps.log(`the ${MAIN} ruleset's required checks cannot be read`);
    return 1;
  }
  const read = await deps.gh(["api", `${REPO}/pulls/${n}`]);
  if (read.code !== 0) {
    deps.log(`#${n} cannot be read`);
    return 1;
  }
  const pr = JSON.parse(read.stdout) as {
    draft: boolean;
    head: { ref: string; sha: string };
    base: { ref: string };
    mergeable_state?: string;
  };
  let reason: string | null = null;
  if (pr.draft) reason = "a draft";
  else if (pr.base.ref !== MAIN)
    reason = `onto ${pr.base.ref}, not ${MAIN}: merge its parent first`;
  else reason = await checksProblem(deps, pr.head.sha, required);
  const state = pr.mergeable_state ?? "unknown";
  if (!reason && cleanOnly && state !== "clean") {
    reason = `GitHub says ${state}, not clean: run bun run pr -- auto ${n} again`;
  }
  if (!reason && state === "dirty") reason = conflictText(MAIN, pr.head.ref);
  if (reason) {
    deps.log(`#${n} not merged: ${reason}`);
    return 2;
  }
  // Behind main merges (#305): a note for a hand merge; main's push CI checks the result.
  const behind = await behindBy(deps, MAIN, pr.head.ref);
  if (behind > 0) {
    deps.log(
      `#${n} is ${behind} commit(s) behind ${MAIN} (merged anyway; ${MAIN}'s push CI runs on the result)`,
    );
  }
  const merged = await deps.gh([
    "api",
    "-X",
    "PUT",
    `${REPO}/pulls/${n}/merge`,
    "-f",
    "merge_method=merge",
    "-f",
    `sha=${pr.head.sha}`,
  ]);
  deps.log(merged.code === 0 ? `#${n} merged into ${MAIN}` : `GitHub refused to merge #${n}`);
  return merged.code === 0 ? 0 : 1;
}
