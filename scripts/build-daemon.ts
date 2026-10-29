#!/usr/bin/env bun
/** Compiles `flightdeckd` into single-file executables for every supported target. */
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parsePublicKey } from "../apps/daemon/src/updates/signature.ts";

const ROOT = resolve(import.meta.dir, "..");
const ENTRY = join(ROOT, "apps/daemon/src/bin.ts");
const OUT = join(ROOT, "dist");

const TARGETS = [
  { target: "bun-windows-x64", outfile: "flightdeckd-windows-x64.exe" },
  { target: "bun-linux-x64", outfile: "flightdeckd-linux-x64" },
  { target: "bun-linux-arm64", outfile: "flightdeckd-linux-arm64" },
] as const;

// The daemon embeds release/flightdeck.pub to verify its updates: no valid key, no build.
try {
  parsePublicKey(readFileSync(join(ROOT, "release/flightdeck.pub"), "utf8"));
} catch {
  console.error(
    "build: release/flightdeck.pub não é uma chave pública válida (gere com tauri signer generate)",
  );
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
for (const { target, outfile } of TARGETS) {
  const proc = Bun.spawn(
    [
      process.execPath,
      "build",
      ENTRY,
      "--compile",
      `--target=${target}`,
      "--outfile",
      join(OUT, outfile),
    ],
    { cwd: ROOT, stdout: "inherit", stderr: "inherit" },
  );
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`build de ${target} falhou (código ${code})`);
    process.exit(code);
  }
}
console.log(`binários em ${OUT}`);
