#!/usr/bin/env bun
/** `bun run deploy <alias>`: hosts come from deploy.hosts.json (not versioned). */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnExec } from "../apps/daemon/src/exec.ts";
import { runDeploy } from "./lib/deploy.ts";

const ROOT = resolve(import.meta.dir, "..");
const alias = process.argv.slice(2).find((a) => a !== "--");
if (!alias) {
  console.error("uso: bun run deploy <alias>");
  process.exit(2);
}
process.exit(
  await runDeploy(alias, {
    root: ROOT,
    readHosts: () => readFileSync(resolve(ROOT, "deploy.hosts.json"), "utf8"),
    exec: (cmd) => spawnExec(cmd[0] === "bun" ? [process.execPath, ...cmd.slice(1)] : cmd),
    log: (message) => console.log(message),
  }),
);
