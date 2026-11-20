#!/usr/bin/env bun
/**
 * `bun run release:npm`: packs the CLI's npm tarball (#3541) into `dist/flightdeckd-<version>.tgz`,
 * from the launcher in `release/npm/` and the three daemons `build:daemon` left in `dist/`. It runs on
 * Linux only: `npm pack` on Windows does not keep the execute bit of the binaries. Nothing is published.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { npmTarball, readProductVersions, stageNpmPackage } from "./lib/release/index.ts";

const ROOT = resolve(import.meta.dir, "..");
if (process.platform === "win32") {
  console.error(
    "release: o tarball do npm é empacotado no Linux (o npm no Windows perde o bit de execução)",
  );
  process.exit(1);
}
const version = readProductVersions(ROOT)["apps/desktop"] as string;
const staged = join(mkdtempSync(join(tmpdir(), "fd-npm-")), "package");
try {
  stageNpmPackage(ROOT, staged, version);
} catch (error) {
  console.error(`release: ${(error as Error).message}`);
  process.exit(1);
}
const pack = Bun.spawn(["npm", "pack", "--pack-destination", join(ROOT, "dist"), "--silent"], {
  cwd: staged,
  stdout: "ignore",
  stderr: "inherit",
});
if ((await pack.exited) !== 0) {
  console.error("release: npm pack falhou");
  process.exit(1);
}
console.log(npmTarball(version));
