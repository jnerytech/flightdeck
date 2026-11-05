// `bun run test`: the whole suite with the platform's timeout, then the 100% coverage check. The
// quarantined tests (scripts/test/quarantine.json, issue #288) are left out; `run-quarantine.ts` runs them.
import { excludeArgs, readQuarantine } from "./lib/quarantine.ts";
import { testArgs } from "./test/timeout.ts";

const run = async (args: string[]) =>
  await Bun.spawn([process.execPath, ...args], { stdio: ["inherit", "inherit", "inherit"] }).exited;

const left = excludeArgs(readQuarantine(`${import.meta.dir}/..`));
const code = await run(testArgs(process.platform, [...left, ...Bun.argv.slice(2)]));
process.exit(code === 0 ? await run(["run", "scripts/check-coverage.ts"]) : code);
