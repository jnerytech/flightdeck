#!/usr/bin/env bun
/** `bun run ci:branch <branch> [--only screenshots]`: the branch must already be on origin (#129). */
import { spawnExec } from "../apps/daemon/src/exec.ts";
import { CI_BRANCH_DEFAULTS, ciBranch } from "./lib/ci-branch.ts";

const args = process.argv.slice(2).filter((a) => a !== "--");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "all";
const branch = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--only");
if (!branch || (only !== "all" && only !== "screenshots")) {
  console.error("usage: bun run ci:branch <branch> [--only screenshots]");
  process.exit(2);
}
process.exit(
  await ciBranch(
    branch,
    {
      gh: (cmd) => spawnExec(["gh", ...cmd]),
      sleep: (ms) => Bun.sleep(ms),
      now: () => Date.now(),
      log: (message) => console.log(message),
    },
    { ...CI_BRANCH_DEFAULTS, only },
  ),
);
