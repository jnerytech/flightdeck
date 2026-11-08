// `bun run test`: the whole suite with the platform's timeout, then the coverage check (80% per file, #1002).
import { testArgs } from "./test/timeout.ts";

const run = async (args: string[]) =>
  await Bun.spawn([process.execPath, ...args], { stdio: ["inherit", "inherit", "inherit"] }).exited;

// CI sets FLIGHTDECK_JUNIT to keep each test's time for the slow-test check (#1003).
const code = await run(testArgs(process.platform, Bun.argv.slice(2), process.env.FLIGHTDECK_JUNIT));
process.exit(code === 0 ? await run(["run", "scripts/check-coverage.ts"]) : code);
