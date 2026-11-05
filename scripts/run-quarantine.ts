// The quarantine job: `bun run scripts/run-quarantine.ts` runs only the tests of
// scripts/test/quarantine.json (issue #288) with the platform's timeout. An empty list runs nothing.
import { onlyArgs, readQuarantine } from "./lib/quarantine.ts";
import { testArgs } from "./test/timeout.ts";

const only = onlyArgs(readQuarantine(`${import.meta.dir}/..`));
if (only.length === 0) {
  console.log("quarantine: the list is empty, nothing to run");
  process.exit(0);
}
const proc = Bun.spawn(
  [process.execPath, "--config=bunfig.area.toml", ...testArgs(process.platform, only)],
  { stdio: ["inherit", "inherit", "inherit"] },
);
process.exit(await proc.exited);
