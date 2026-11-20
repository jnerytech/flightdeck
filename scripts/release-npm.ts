#!/usr/bin/env bun
/**
 * `bun run release:npm`: packs the CLI's npm tarball (#3541) into `dist/flightdeckd-<version>.tgz`,
 * from the launcher in `release/npm/` and the three daemons `build:daemon` left in `dist/`. It runs on
 * Linux only: `npm pack` on Windows does not keep the execute bit of the binaries. Nothing is published.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { npmTarball, readProductVersions, stageNpmPackage } from "./lib/release/index.ts";

const ROOT = resolve(import.meta.dir, "..");
if (process.platform === "win32") {
  console.error(
    "release: the npm tarball is packed on Linux (npm on Windows loses the execute bit)",
  );
  process.exit(1);
}
const version = readProductVersions(ROOT)["apps/desktop"] as string;
const work = mkdtempSync(join(tmpdir(), "fd-npm-"));
const staged = join(work, "package");
/** The staged copy holds all three binaries: it goes away on every way out. */
const finish = (code: number) => {
  rmSync(work, { recursive: true, force: true });
  process.exit(code);
};
try {
  stageNpmPackage(ROOT, staged, version);
} catch (error) {
  console.error(`release: ${(error as Error).message}`);
  finish(1);
}
const pack = Bun.spawn(["npm", "pack", "--pack-destination", join(ROOT, "dist"), "--silent"], {
  cwd: staged,
  stdout: "ignore",
  stderr: "inherit",
});
if ((await pack.exited) !== 0) {
  console.error("release: npm pack failed");
  finish(1);
}
console.log(npmTarball(version));
finish(0);
