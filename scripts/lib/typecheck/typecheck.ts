/**
 * `bun run typecheck`: one tsc run per project, each with its incremental build info, one after
 * the other or two at a time when memory allows (`typecheckJobs`). `bun run --filter '*' typecheck`
 * ran the three workspaces at once (about 2.7 GB on this repository); one project alone peaks near
 * 2 GB, two of the largest near 4 GB. The projects share no build output (each imports the others'
 * sources), so their order does not matter; a second run with nothing changed reuses the build
 * info (desktop: 4 s instead of 29 s). The run ends with each project's time (#1762).
 */

/** The projects, the protocol first (it is the quickest and the others import its sources). */
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
  const label = (command: string[]) =>
    (command[2] ?? command.join(" ")).replace(/\/tsconfig\.json$/, "");
  const codes: number[] = [];
  const times: number[] = [];
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < commands.length; index = next++) {
      const command = commands[index] as string[];
      log(`typecheck ${command[2] ?? command.join(" ")}`);
      const started = now();
      try {
        codes[index] = await run(command); // NOSONAR: a worker's runs follow one another by design
      } catch (error) {
        codes[index] = 1;
        log(`typecheck ${label(command)}: could not run: ${(error as Error).message}`);
      }
      times[index] = now() - started;
    }
  };
  const begin = now();
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, options.limit ?? 1), commands.length) }, worker),
  );
  const each = commands.map((command, index) => `${label(command)} ${seconds(times[index] ?? 0)}`);
  log(`typecheck: ${each.join(", ")}, total ${seconds(now() - begin)}`);
  return codes.find((code) => code !== 0) ?? 0;
}
