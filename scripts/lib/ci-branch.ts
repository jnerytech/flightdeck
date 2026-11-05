/** `bun run ci:branch <branch>`: runs the full CI on a pushed work branch and reports the result (#129). */

export interface GhResult {
  code: number;
  stdout: string;
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

async function runIds(branch: string, deps: CiBranchDeps): Promise<number[]> {
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
  if (list.code !== 0) return [];
  return (JSON.parse(list.stdout) as Array<{ databaseId: number }>).map((run) => run.databaseId);
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
  const before = new Set(await runIds(branch, deps));
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
      `ci-branch: gh refused the dispatch (is ${branch} pushed to origin?): ${dispatch.stdout.trim()}`,
    );
    return 2;
  }
  deps.log(`ci-branch: dispatched ci.yml on ${branch} (only=${options.only})`);

  const appearBy = deps.now() + options.appearMs;
  let id: number | undefined;
  while (id === undefined) {
    id = (await runIds(branch, deps)).find((candidate) => !before.has(candidate));
    if (id !== undefined) break;
    if (deps.now() >= appearBy) {
      deps.log(`ci-branch: the run did not appear within ${Math.round(options.appearMs / 1000)} s`);
      return 2;
    }
    await deps.sleep(options.pollMs);
  }

  const doneBy = deps.now() + options.waitMs;
  let view: RunView;
  for (;;) {
    const answer = await deps.gh([
      "run",
      "view",
      String(id),
      "--json",
      "status,conclusion,url,jobs",
    ]);
    view = JSON.parse(answer.stdout) as RunView;
    if (view.status === "completed") break;
    if (deps.now() >= doneBy) {
      deps.log(
        `ci-branch: run ${id} is still ${view.status} after ${Math.round(options.waitMs / 60_000)} min: ${view.url}`,
      );
      return 2;
    }
    await deps.sleep(options.pollMs);
  }

  deps.log(`ci-branch: ${view.conclusion} ${view.url}`);
  for (const job of view.jobs) deps.log(`  ${job.name}: ${job.conclusion}`);
  const names = await deps.gh([
    "api",
    `repos/{owner}/{repo}/actions/runs/${id}/artifacts`,
    "--jq",
    "[.artifacts[].name]",
  ]);
  if (names.code === 0) {
    for (const name of JSON.parse(names.stdout) as string[]) {
      deps.log(`  artifact ${name}: gh run download ${id} -n ${name}`);
    }
  }
  return view.conclusion === "success" ? 0 : 1;
}
