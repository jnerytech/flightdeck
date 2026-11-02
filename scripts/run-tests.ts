// `bun run test`: the whole suite with the platform's timeout, then the 100% coverage check.
import { testArgs } from "./test/timeout.ts";

const run = async (args: string[]) =>
  await Bun.spawn([process.execPath, ...args], { stdio: ["inherit", "inherit", "inherit"] }).exited;

const code = await run(testArgs(process.platform, Bun.argv.slice(2)));
process.exit(code === 0 ? await run(["run", "scripts/check-coverage.ts"]) : code);
