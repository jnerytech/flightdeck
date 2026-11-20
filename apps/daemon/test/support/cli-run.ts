/** Runs a `flightdeckd` command line the way the process entry does, against a config that points at a test daemon. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CliDeps } from "../../src/cli/commands.ts";
import { runCommandCli } from "../../src/cli/run.ts";
import { TOKEN } from "../board/card-cli-helpers.ts";
import { tempDir } from "./helpers.ts";

export interface CliRun {
  /** What went to stdout, one entry per line the command printed. */
  out: string[];
  /** What went to stderr, one entry per line the command printed. */
  err: string[];
  /** The exit code the command asked for; null when it asked for none. */
  code: number | null;
}

/** `flightdeckd <argv> --config <file>`, with a config whose daemon is at `port` (or the text `rawConfig`, as the file). */
export async function flightdeckd(
  argv: string[],
  port: number,
  rawConfig?: string,
): Promise<CliRun> {
  const dir = tempDir("fd-cli-run-");
  const file = join(dir, "config.json");
  writeFileSync(file, rawConfig ?? JSON.stringify({ token: TOKEN, dataDir: dir, port }));
  const run: CliRun = { out: [], err: [], code: null };
  const deps = {
    env: {},
    log: { log: (line: string) => run.out.push(line), error: (line: string) => run.err.push(line) },
    exit: (code: number) => {
      run.code = code;
    },
    onSignal: () => {},
  } as unknown as CliDeps;
  const handled = await runCommandCli([...argv, "--config", file], deps);
  if (!handled)
    throw new Error(`flightdeckd ${argv.join(" ")} is not a command that asks a daemon`);
  return run;
}
