#!/usr/bin/env bun
/**
 * `bun run release:sign`: signs each daemon of `dist/` with `tauri signer sign`, which writes the
 * `.sig` next to it. The key comes from TAURI_SIGNING_PRIVATE_KEY (and its _PASSWORD).
 */
import { resolve } from "node:path";
import { DAEMONS } from "./lib/release.ts";

const ROOT = resolve(import.meta.dir, "..");
for (const daemon of DAEMONS) {
  const proc = Bun.spawn(
    [process.execPath, "run", "tauri", "signer", "sign", resolve(ROOT, daemon)],
    { cwd: resolve(ROOT, "apps/desktop"), env: process.env, stdout: "ignore", stderr: "inherit" },
  );
  if ((await proc.exited) !== 0) {
    console.error(`release: falhou ao assinar ${daemon}`);
    process.exit(1);
  }
  console.log(`${daemon}.sig`);
}
