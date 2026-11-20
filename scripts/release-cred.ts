#!/usr/bin/env bun
/**
 * `bun run release:cred`: after `cargo build -p flightdeck-cred --release`, copies the helper to
 * where `tauri build` expects the sidecar of this machine's target (issue #3429).
 */
import { resolve } from "node:path";
import { hostTriple, stageCredHelper } from "./lib/release/index.ts";

try {
  const rustc = Bun.spawnSync(["rustc", "-vV"], { stdout: "pipe", stderr: "pipe" });
  if (rustc.exitCode !== 0) throw new Error(`rustc -vV failed: ${rustc.stderr.toString().trim()}`);
  console.log(stageCredHelper(resolve(import.meta.dir, ".."), hostTriple(rustc.stdout.toString())));
} catch (error) {
  console.error(`release: ${(error as Error).message}`);
  process.exit(1);
}
