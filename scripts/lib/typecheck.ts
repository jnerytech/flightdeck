/**
 * `bun run typecheck`: one tsc run per project, one after the other, each with its incremental
 * build info. `bun run --filter '*' typecheck` ran the three workspaces at once (about 2.7 GB on
 * this repository); in sequence the peak is the largest project (about 1.5 GB), and a second run
 * with nothing changed reuses the build info (desktop: 0.45 GB and 4 s instead of 1.5 GB and 29 s).
 */

/** The projects in the order they run: the protocol first, since the apps import it. */
export const PROJECTS = ["packages/protocol", "apps/daemon", "apps/desktop", "scripts"];

/** The tsc command of each project, with its build info under the ignored node_modules/.cache. */
export function typecheckPlan(projects: string[] = PROJECTS): string[][] {
  return projects.map((dir) => [
    "tsc",
    "-p",
    `${dir}/tsconfig.json`,
    "--incremental",
    "--tsBuildInfoFile",
    `node_modules/.cache/tsc/${dir.replaceAll("/", "-")}.tsbuildinfo`,
  ]);
}

/** Runs every command in order (all of them, so one run shows every error) and returns the first failure. */
export async function runAll(
  commands: string[][],
  run: (command: string[]) => Promise<number>,
  log: (line: string) => void,
): Promise<number> {
  let first = 0;
  for (const command of commands) {
    log(`typecheck ${command[2] ?? command.join(" ")}`);
    const code = await run(command);
    first ||= code;
  }
  return first;
}
