import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  keyMatches,
  primaryFingerprints,
  SONAR_KEY_FINGERPRINT,
  scannerFiles,
  withRetry,
} from "../../lib/sonar-scanner.ts";
import { realTempDir } from "../temp-dir.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const PRIMARY = "679F1EE92B19609DE816FDE81DB198F93525EC1A";
const SUBKEY = "06D0369BE1D0B06997DA66E8C33B56C147B01975";
/** `gpg --with-colons` for a key with one signing subkey. */
const COLONS = [
  "pub:-:4096:1:1DB198F93525EC1A:1619438987:1934967538::-:::cSC::::::23::0:",
  `fpr:::::::::${PRIMARY}:`,
  "uid:-::::1619438987::AAAA::SonarSource S.A. <infra@sonarsource.com>::::::::::0:",
  "sub:-:4096:1:C33B56C147B01975:1783344860:1814880860:::::s::::::23:",
  `fpr:::::::::${SUBKEY}:`,
].join("\n");

describe("sonar scanner download (#1883)", () => {
  test("the pinned fingerprint is SonarSource's primary key", () => {
    expect(SONAR_KEY_FINGERPRINT).toBe(PRIMARY);
  });

  test("the scanner zip and its signature are named from the version and the platform", () => {
    expect(
      scannerFiles(
        "https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/",
        "8.3.0.16463",
        "linux-x64",
      ),
    ).toEqual({
      name: "sonar-scanner-cli-8.3.0.16463-linux-x64.zip",
      zip: "https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/sonar-scanner-cli-8.3.0.16463-linux-x64.zip",
      asc: "https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/sonar-scanner-cli-8.3.0.16463-linux-x64.zip.asc",
    });
  });

  test("only a primary key's fingerprint counts, never a subkey's", () => {
    expect(primaryFingerprints(COLONS)).toEqual([PRIMARY]);
  });

  test("the key matches only when it is exactly the one primary key that was pinned", () => {
    expect(keyMatches(COLONS, PRIMARY)).toBe(true);
    expect(keyMatches(COLONS, PRIMARY.toLowerCase())).toBe(true);
    expect(keyMatches(COLONS, SUBKEY)).toBe(false);
    expect(keyMatches("", PRIMARY)).toBe(false);
    const two = `${COLONS}\npub:-:4096:1:AAAAAAAAAAAAAAAA:1:2::-:::cSC::::::23::0:\nfpr:::::::::${"A".repeat(40)}:`;
    expect(keyMatches(two, PRIMARY)).toBe(false);
  });

  test("a retry runs the attempt again once, and stops at the first answer", async () => {
    const calls: number[] = [];
    const flaky = (okAt: number) => async () => {
      calls.push(calls.length + 1);
      return calls.length >= okAt;
    };
    expect(await withRetry(flaky(2), 2)).toBe(true);
    expect(calls).toEqual([1, 2]);
    calls.length = 0;
    expect(await withRetry(flaky(3), 2)).toBe(false);
    expect(calls).toEqual([1, 2]);
    calls.length = 0;
    expect(await withRetry(flaky(1), 2)).toBe(true);
    expect(calls).toEqual([1]);
  });

  const gpg = spawnSync("gpg", ["--version"]);
  test.skipIf(gpg.status !== 0)("the committed key file holds the pinned primary key", () => {
    const home = realTempDir("sonar-key-");
    try {
      const listed = spawnSync(
        "gpg",
        [
          "--homedir",
          home,
          "--batch",
          "--with-colons",
          "--import-options",
          "show-only",
          "--import",
          join(ROOT, ".github/keys/sonarsource-public.asc"),
        ],
        { encoding: "utf8" },
      );
      expect(keyMatches(listed.stdout, SONAR_KEY_FINGERPRINT)).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("the sonarcloud job verifies the scanner itself and hands the action the verified copy", () => {
    const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
    const job = ci.slice(ci.indexOf("\n  sonar:"), ci.indexOf("\n  checks-linux:"));
    expect(job).toContain("scripts/sonar-scanner-verify.ts");
    expect(job).toMatch(/skipSignatureVerification: true/);
    expect(job).toMatch(/scannerBinariesUrl: http:\/\/127\.0\.0\.1:/);
    expect(job).toMatch(/verify[^\n]*\n(?:[^\n]*\n){0,4}?\s+timeout-minutes: 3/);
  });
});
