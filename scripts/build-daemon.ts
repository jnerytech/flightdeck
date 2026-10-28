#!/usr/bin/env bun
/** Compiles `flightdeckd` into single-file executables for every supported target. */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const ENTRY = join(ROOT, "apps/daemon/src/main.ts");
const OUT = join(ROOT, "dist");

const TARGETS = [
  { target: "bun-windows-x64", outfile: "flightdeckd-windows-x64.exe" },
  { target: "bun-linux-x64", outfile: "flightdeckd-linux-x64" },
  { target: "bun-linux-arm64", outfile: "flightdeckd-linux-arm64" },
] as const;

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
