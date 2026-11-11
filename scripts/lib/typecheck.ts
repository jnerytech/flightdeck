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

/** What `runAll` may be told: how many projects run at once and the clock for the timings. */
export interface RunOptions {
  limit?: number;
  now?: () => number;
}

/**
 * How many tsc runs may go at once: one, or two when the machine has at least 8 GB available (the
 * two largest projects peak near 4 GB together). `meminfo` is /proc/meminfo, null off Linux;
 * FLIGHTDECK_TYPECHECK_JOBS (`override`) wins when it is a whole number of at least 1.
 */
export function typecheckJobs(meminfo: string | null, override: string | undefined): number {
  const forced = Number(override);
  if (Number.isInteger(forced) && forced >= 1) return forced;
  const kb = Number(/^MemAvailable:\s+(\d+)\s*kB/m.exec(meminfo ?? "")?.[1]);
  return kb >= 8 * 1024 * 1024 ? 2 : 1;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/**
 * Runs every command, `limit` at a time (default one, in order), all of them so one run shows every
 * error, and returns the first failure in plan order. The last line says each project's time and
 * the total: where a slow typecheck spends it.
 */
export async function runAll(
  commands: string[][],
  run: (command: string[]) => Promise<number>,
  log: (line: string) => void,
  options: RunOptions = {},
): Promise<number> {
  const now = options.now ?? Date.now;
  const codes: number[] = [];
  const times: number[] = [];
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < commands.length; index = next++) {
      const command = commands[index] as string[];
      log(`typecheck ${command[2] ?? command.join(" ")}`);
      const started = now();
      codes[index] = await run(command); // NOSONAR: a worker's runs follow one another by design
      times[index] = now() - started;
    }
  };
  const begin = now();
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, options.limit ?? 1), commands.length) }, worker),
  );
  const label = (command: string[]) =>
    (command[2] ?? command.join(" ")).replace(/\/tsconfig\.json$/, "");
  const each = commands.map((command, index) => `${label(command)} ${seconds(times[index] ?? 0)}`);
  log(`typecheck: ${each.join(", ")}, total ${seconds(now() - begin)}`);
  return codes.find((code) => code !== 0) ?? 0;
}
