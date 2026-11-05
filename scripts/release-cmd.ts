#!/usr/bin/env bun
/**
 * `bun run release vX.Y.Z` (issue #275): the version bump PR of a release, then the tag and the
 * close, the coordinator's only. The logic is in lib/release-cmd.ts; this wires the real effects.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnExec } from "../apps/daemon/src/exec.ts";
import { release } from "./lib/release-cmd.ts";

const ROOT = resolve(import.meta.dir, "..");

process.exit(
  await release(
    process.argv.slice(2).filter((a) => a !== "--"),
    {
      git: (args) => spawnExec(["git", ...args]),
      gh: (args) => spawnExec(["gh", ...args]),
      bun: (args) => spawnExec(["bun", ...args]),
      read: (path) => readFileSync(resolve(ROOT, path), "utf8"),
      write: (path, text) => writeFileSync(resolve(ROOT, path), text),
      env: process.env,
      log: (line) => console.log(line),
    },
  ),
);
