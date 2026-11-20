import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  hostTriple,
  SIDECAR_ENTRY,
  sidecarFile,
  stageCredHelper,
  tauriReleaseConfig,
} from "../../lib/release/index.ts";
import { realTempDir } from "../temp-dir.ts";

const ROOT = join(import.meta.dir, "../../..");
const RUSTC = [
  "rustc 1.91.0 (f8297e351 2025-10-28)",
  "binary: rustc",
  "host: x86_64-pc-windows-msvc",
  "release: 1.91.0",
  "",
].join("\n");
const WINDOWS = "x86_64-pc-windows-msvc";
const SRC_TAURI = "apps/desktop/src-tauri";

describe("cred-sidecar: the release ships flightdeck-cred beside the app (#3429)", () => {
  test("the host triple is the host line of rustc -vV, and a report without one is refused", () => {
    expect(hostTriple(RUSTC)).toBe(WINDOWS);
    expect(() => hostTriple("rustc 1.91.0\nrelease: 1.91.0\n")).toThrow("no host line");
  });

  test("the sidecar file carries the triple, and .exe only on Windows", () => {
    expect(sidecarFile(WINDOWS)).toBe("flightdeck-cred-x86_64-pc-windows-msvc.exe");
    expect(sidecarFile("x86_64-unknown-linux-gnu")).toBe(
      "flightdeck-cred-x86_64-unknown-linux-gnu",
    );
    expect(sidecarFile("aarch64-apple-darwin")).toBe("flightdeck-cred-aarch64-apple-darwin");
  });

  test("the release config declares the helper as an external binary, and the base config does not", () => {
    const pub = readFileSync(join(ROOT, "release/flightdeck.pub"), "utf8");
    expect(tauriReleaseConfig(pub).bundle.externalBin).toEqual([SIDECAR_ENTRY]);
    expect(SIDECAR_ENTRY).toBe("binaries/flightdeck-cred");
    // A dev or CI build has no helper binary: Tauri fails when a declared sidecar is missing.
    const base = JSON.parse(readFileSync(join(ROOT, SRC_TAURI, "tauri.conf.json"), "utf8"));
    expect(base.bundle.externalBin).toBeUndefined();
  });

  test("the staged file is the release build of the helper, copied under the sidecar name", () => {
    const root = realTempDir("fd-cred-sidecar-");
    mkdirSync(join(root, SRC_TAURI, "target/release"), { recursive: true });
    writeFileSync(join(root, SRC_TAURI, "target/release/flightdeck-cred.exe"), "helper-bytes");
    const staged = stageCredHelper(root, WINDOWS);
    expect(staged).toBe(
      join(root, SRC_TAURI, "binaries", "flightdeck-cred-x86_64-pc-windows-msvc.exe"),
    );
    expect(readFileSync(staged, "utf8")).toBe("helper-bytes");
  });

  test("staging without a built helper fails and leaves no sidecar behind", () => {
    const root = realTempDir("fd-cred-sidecar-");
    expect(() => stageCredHelper(root, "x86_64-unknown-linux-gnu")).toThrow("flightdeck-cred");
    expect(existsSync(join(root, SRC_TAURI, "binaries"))).toBe(false);
  });

  test("the release workflow builds the helper and stages it before the installers are built", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
    const build = workflow.indexOf("cargo build");
    const stage = workflow.indexOf("release:cred");
    const installers = workflow.indexOf("tauri build");
    expect(build).toBeGreaterThan(-1);
    expect(workflow).toContain("-p flightdeck-cred --release");
    expect(stage).toBeGreaterThan(build);
    expect(installers).toBeGreaterThan(stage);
  });
});
