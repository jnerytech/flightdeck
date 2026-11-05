// One shard of the Windows leg: `bun run scripts/run-shard.ts <n>` runs shard n of 3 with the
// platform's timeout, leaving out the quarantined tests (scripts/test/quarantine.json, issue #288).
import { readQuarantine, shardArgs } from "./lib/quarantine.ts";

const shard = Number(Bun.argv[2]);
if (![1, 2, 3].includes(shard)) {
  console.error("usage: bun run scripts/run-shard.ts <1|2|3>");
  process.exit(2);
}
const args = shardArgs(process.platform, shard, readQuarantine(`${import.meta.dir}/..`));
const proc = Bun.spawn([process.execPath, ...args], { stdio: ["inherit", "inherit", "inherit"] });
process.exit(await proc.exited);
