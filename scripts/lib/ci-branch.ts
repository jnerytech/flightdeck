/** `bun run ci:branch <branch>`: runs the full CI on a pushed work branch and reports the result (#129). */

export interface GhResult {
  code: number;
  stdout: string;
  /** Where `gh` writes its errors. */
  stderr?: string;
}

export interface CiBranchDeps {
  /** Runs `gh <args>`; the caller owns the repository and the login. */
  gh: (args: string[]) => Promise<GhResult>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: (message: string) => void;
}

export interface CiBranchOptions {
  /** "screenshots" runs only the prints, axe and e2e job. */
  only: "all" | "screenshots";
  /** How long to wait for the run to appear and then to finish. */
  appearMs: number;
  waitMs: number;
  pollMs: number;
}

export const CI_BRANCH_DEFAULTS: CiBranchOptions = {
  only: "all",
  appearMs: 120_000,
  waitMs: 60 * 60_000,
  pollMs: 15_000,
};

/** Letters, digits and the characters git branches use; nothing a shell or an option parser would read. */
const BRANCH = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;

interface RunView {
  status: string;
  conclusion: string | null;
  url: string;
  jobs: Array<{ name: string; conclusion: string | null }>;
}

/** What gh said when it failed: its errors go to stderr, older answers to stdout. */
const said = (answer: GhResult): string =>
  (answer.stderr?.trim() || answer.stdout.trim()).slice(0, 300);

/** The ids of the dispatch runs of the branch, or null when gh could not say (not "none"). */
async function runIds(branch: string, deps: CiBranchDeps): Promise<number[] | null> {
  const list = await deps.gh([
    "run",
    "list",
    "--workflow",
    "ci.yml",
    "--branch",
    branch,
    "--event",
    "workflow_dispatch",
    "--limit",
    "10",
    "--json",
    "databaseId",
  ]);
  if (list.code !== 0) {
    deps.log(`ci-branch: gh run list failed: ${said(list)}`);
    return null;
  }
  try {
    return (JSON.parse(list.stdout) as Array<{ databaseId: number }>).map((run) => run.databaseId);
  } catch {
    deps.log(`ci-branch: gh run list did not answer JSON: ${said(list)}`);
    return null;
  }
}

function parseView(answer: GhResult): RunView | null {
  if (answer.code !== 0) return null;
  try {
    return JSON.parse(answer.stdout) as RunView;
  } catch {
    return null;
  }
}

/** Looks at a run until it completes; null (after saying why) when it cannot be looked at or is still running at the deadline. */
async function waitForRun(
  id: number,
  deps: CiBranchDeps,
  options: CiBranchOptions,
): Promise<RunView | null> {
  const doneBy = deps.now() + options.waitMs;
  let failures = 0;
  for (;;) {
    const answer = await deps.gh([
      "run",
      "view",
      String(id),
      "--json",
      "status,conclusion,url,jobs",
    ]);
    const view = parseView(answer);
    if (!view) {
      // A network blip must not lose a wait of up to an hour: a few looks, then give up.
      failures += 1;
      if (failures >= 3) {
        deps.log(`ci-branch: could not look at run ${id}: ${said(answer)}`);
        return null;
      }
      await deps.sleep(options.pollMs);
      continue;
    }
    failures = 0;
    if (view.status === "completed") return view;
    if (deps.now() >= doneBy) {
      deps.log(
        `ci-branch: run ${id} is still ${view.status} after ${Math.round(options.waitMs / 60_000)} min: ${view.url}`,
      );
      return null;
    }
    await deps.sleep(options.pollMs);
  }
}

/** Prints how to download each artifact of the run. */
async function logArtifacts(id: number, deps: CiBranchDeps): Promise<void> {
  const names = await deps.gh([
    "api",
    `repos/{owner}/{repo}/actions/runs/${id}/artifacts`,
    "--jq",
    "[.artifacts[].name]",
  ]);
  if (names.code !== 0) return;
  for (const name of JSON.parse(names.stdout) as string[]) {
    deps.log(`  artifact ${name}: gh run download ${id} -n ${name}`);
  }
}

/** Dispatches CI on `branch`, waits for it and prints the result. Exit code: 0 green, 1 red, 2 could not run. */
export async function ciBranch(
  branch: string,
  deps: CiBranchDeps,
  options: CiBranchOptions = CI_BRANCH_DEFAULTS,
): Promise<number> {
  if (!BRANCH.test(branch)) {
    deps.log(`ci-branch: "${branch}" is not a plain branch name`);
    return 2;
  }
  // Without the runs that were there before, an old one could be taken for the new one.
  const known = await runIds(branch, deps);
  if (!known) return 2;
  const before = new Set(known);
  const dispatch = await deps.gh([
    "workflow",
    "run",
    "ci.yml",
    "--ref",
    branch,
    "-f",
    `only=${options.only}`,
  ]);
  if (dispatch.code !== 0) {
    deps.log(
      `ci-branch: gh refused the dispatch (is ${branch} pushed to origin?): ${said(dispatch)}`,
    );
    return 2;
  }
  deps.log(`ci-branch: dispatched ci.yml on ${branch} (only=${options.only})`);

  const appearBy = deps.now() + options.appearMs;
  let id: number | undefined;
  while (id === undefined) {
    // A list that fails now is a look that failed: the run may be there on the next one.
    id = ((await runIds(branch, deps)) ?? []).find((candidate) => !before.has(candidate));
    if (id !== undefined) break;
    if (deps.now() >= appearBy) {
      deps.log(`ci-branch: the run did not appear within ${Math.round(options.appearMs / 1000)} s`);
      return 2;
    }
    await deps.sleep(options.pollMs);
  }

  const view = await waitForRun(id, deps, options);
  if (view === null) return 2;

  deps.log(`ci-branch: ${view.conclusion} ${view.url}`);
  if (view.conclusion === "cancelled") {
    // Another run took its place (or someone stopped it): not a verdict on the code.
    deps.log(
      `ci-branch: run ${id} was cancelled, so it says nothing about the branch; run it again`,
    );
    return 2;
  }
  for (const job of view.jobs) deps.log(`  ${job.name}: ${job.conclusion}`);
  await logArtifacts(id, deps);
  return view.conclusion === "success" ? 0 : 1;
}
