/**
 * What the `git` of `installSleepingGit` runs: records the call, waits, then runs the real git with
 * the same arguments and standard streams, and exits with its code.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [dir, ...args] = process.argv.slice(2);
const options = JSON.parse(readFileSync(join(dir as string, "options.json"), "utf8")) as {
  delayMs: number;
  realGit: string;
};
appendFileSync(join(dir as string, "calls.jsonl"), `${JSON.stringify(args)}\n`);
await Bun.sleep(options.delayMs);
const proc = Bun.spawnSync([options.realGit, ...args], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(proc.exitCode);
