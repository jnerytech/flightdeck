#!/usr/bin/env bun
/**
 * `bun run release:assets [pasta]`: after `build:daemon` and `tauri build --bundles nsis,msi`,
 * gathers the release files and their SHA256SUMS in `pasta` (`release-assets/` by default; `release/` holds the public key).
 */
import { resolve } from "node:path";
import { collectReleaseAssets, readProductVersions } from "./lib/release.ts";

const ROOT = resolve(import.meta.dir, "..");
const out = resolve(ROOT, process.argv.slice(2).find((a) => a !== "--") ?? "release-assets");
const version = readProductVersions(ROOT)["apps/desktop"] as string;
try {
  for (const asset of collectReleaseAssets(ROOT, version, out)) console.log(asset.path);
  console.log(resolve(out, "SHA256SUMS"));
} catch (error) {
  console.error(`release: ${(error as Error).message}`);
  process.exit(1);
}
