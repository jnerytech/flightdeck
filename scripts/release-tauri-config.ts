#!/usr/bin/env bun
/**
 * `bun run release:tauri-config [arquivo]`: writes what `tauri build --config <arquivo>` merges
 * for a release (updater artifacts, public key, endpoint). Fails while release/flightdeck.pub is
 * not a real key.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tauriReleaseConfig } from "./lib/release.ts";

const ROOT = resolve(import.meta.dir, "..");
const out = resolve(
  ROOT,
  process.argv.slice(2).find((a) => a !== "--") ??
    "apps/desktop/src-tauri/target/tauri.release.conf.json",
);
try {
  const config = tauriReleaseConfig(readFileSync(resolve(ROOT, "release/flightdeck.pub"), "utf8"));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`);
  console.log(out);
} catch (error) {
  console.error(`release: ${(error as Error).message}`);
  process.exit(1);
}
