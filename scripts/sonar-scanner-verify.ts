/**
 * Downloads the SonarScanner zip the sonarcloud job scans with, and checks its signature against
 * SonarSource's committed public key (#1883): no keyserver, a timeout on every call, one retry.
 * Usage: bun run scripts/sonar-scanner-verify.ts <folder>   (SONAR_SCANNER_VERSION in the environment)
 * On success the folder holds the verified zip under the name the scan action asks for.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { keyMatches, SONAR_KEY_FINGERPRINT, scannerFiles, withRetry } from "./lib/sonar/scanner.ts";

const BASE = "https://binaries.sonarsource.com/Distribution/sonar-scanner-cli";
const KEY = resolve(import.meta.dir, "../.github/keys/sonarsource-public.asc");
const FLAVORS: Record<string, string> = { x64: "linux-x64", arm64: "linux-aarch64" };

const [folder] = process.argv.slice(2);
const version = process.env.SONAR_SCANNER_VERSION ?? "";
const flavor = FLAVORS[process.arch];
if (!folder || !/^[0-9][0-9.]*$/.test(version) || !flavor) {
  console.error(
    "usage: SONAR_SCANNER_VERSION=<x.y.z.n> bun run scripts/sonar-scanner-verify.ts <folder>",
  );
  process.exit(2);
}
mkdirSync(folder, { recursive: true });
const files = scannerFiles(BASE, version, flavor);

const run = (cmd: string, args: string[], timeoutMs: number) =>
  spawnSync(cmd, args, { encoding: "utf8", timeout: timeoutMs });

/** One attempt: download both files, import the committed key, verify. */
async function attempt(): Promise<boolean> {
  const home = mkdtempSync(join(tmpdir(), "sonar-gpg-"));
  const zip = join(folder as string, files.name);
  const asc = `${zip}.asc`;
  try {
    for (const [url, to] of [
      [files.zip, zip],
      [files.asc, asc],
    ] as const) {
      const got = run(
        "curl",
        [
          "-fsSL",
          "--proto",
          "=https",
          "--proto-redir",
          "=https",
          "--max-time",
          "60",
          "-o",
          to,
          url,
        ],
        75_000,
      );
      if (got.status !== 0) {
        console.error(`download of ${url} failed (exit ${got.status})`);
        return false;
      }
    }
    const shown = run(
      "gpg",
      [
        "--homedir",
        home,
        "--batch",
        "--with-colons",
        "--import-options",
        "show-only",
        "--import",
        KEY,
      ],
      30_000,
    );
    if (!keyMatches(shown.stdout, SONAR_KEY_FINGERPRINT)) {
      console.error(`the committed key is not the pinned ${SONAR_KEY_FINGERPRINT}`);
      return false;
    }
    if (run("gpg", ["--homedir", home, "--batch", "--import", KEY], 30_000).status !== 0)
      return false;
    const verdict = run("gpg", ["--homedir", home, "--batch", "--verify", asc, zip], 30_000);
    if (verdict.status !== 0) {
      console.error(`the signature of ${files.name} does not verify against the pinned key`);
      return false;
    }
    return true;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

if (!(await withRetry(attempt, 2))) {
  rmSync(join(folder, files.name), { force: true });
  console.error("sonar-scanner-verify: no verified scanner after 2 attempts");
  process.exit(1);
}
console.log(`sonar-scanner-verify: ${files.name} verified against ${SONAR_KEY_FINGERPRINT}`);
