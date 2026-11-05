import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";
import {
  CANARY_MODEL,
  type DiscoveryDeps,
  discoverOpenCode,
  parseOpenCodeVersion,
  resolveOpenCodePath,
} from "../src/runtime/opencode-discovery.ts";
import { globalConfigDir } from "../src/runtime/opencode-scope.ts";

/** The global folder as the code computes it here (backslashes on Windows). */
const GLOBAL = globalConfigDir({ HOME: "/home/u" });

interface Call {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
}

/** Deps where `opencode` is on PATH at /bin/opencode, version 2.2.5, a clean scope and a passing canary. */
function deps(overrides: Partial<DiscoveryDeps> = {}, answers: Record<string, string | null> = {}) {
  const calls: Call[] = [];
  const dataDir = realTempDir("fd-oc-data-");
  const base: DiscoveryDeps = {
    env: { HOME: "/home/u", PATH: "/bin", OPENCODE_CONFIG: "/evil.json" },
    platform: "linux",
    dataDir,
    which: (bin) => (bin === "opencode" ? "/bin/opencode" : null),
    exists: () => false,
    scan: async () => ({ findings: [], fingerprint: "f" }),
    run: async (argv, opts) => {
      calls.push({ argv, ...opts });
      const key = argv.slice(1).join(" ");
      const answer =
        key in answers ? (answers[key] ?? null) : key === "--version" ? "opencode v2.2.5\n" : "[]";
      return answer === null ? { exitCode: 1, stdout: "" } : { exitCode: 0, stdout: answer };
    },
    ...overrides,
  };
  return { deps: base, calls, dataDir };
}

const sources = (...paths: string[]) =>
  JSON.stringify([
    { type: "directory", path: GLOBAL },
    { type: "document", info: {} },
    ...paths.map((path) => ({ type: "document", path, info: { model: CANARY_MODEL } })),
  ]);

describe("opencode-discovery", () => {
  test("the version comes from `opencode vX.Y.Z`", () => {
    expect(parseOpenCodeVersion("opencode v2.2.5\n")).toBe("2.2.5");
    expect(parseOpenCodeVersion("opencode v10.0.1-beta")).toBe("10.0.1-beta");
    expect(parseOpenCodeVersion("hello")).toBe(null);
  });

  test("the executable: config first, then PATH, then <HOME>/.opencode/bin (with .exe on Windows)", () => {
    const { deps: d } = deps();
    expect(resolveOpenCodePath("/opt/oc", d)).toBe("/opt/oc");
    expect(resolveOpenCodePath(undefined, d)).toBe("/bin/opencode");
    const home = {
      ...d,
      which: () => null,
      exists: (p: string) => p === join("/home/u", ".opencode", "bin", "opencode"),
    };
    expect(resolveOpenCodePath(undefined, home)).toBe(
      join("/home/u", ".opencode", "bin", "opencode"),
    );
    const win = {
      ...d,
      platform: "win32" as const,
      env: { USERPROFILE: "C:/Users/u" },
      which: () => null,
      exists: (p: string) => p === join("C:/Users/u", ".opencode", "bin", "opencode.exe"),
    };
    expect(resolveOpenCodePath(undefined, win)).toBe(
      join("C:/Users/u", ".opencode", "bin", "opencode.exe"),
    );
    expect(resolveOpenCodePath(undefined, { ...d, which: () => null })).toBe(null);
  });

  test("available: path, version, verified; the canary runs in Flightdeck's folder with project config off", async () => {
    const { deps: d, calls, dataDir } = deps();
    expect(await discoverOpenCode({ enabled: true }, d)).toEqual({
      available: true,
      path: "/bin/opencode",
      version: "2.2.5",
      verified: true,
    });
    const canary = calls.find((c) => c.argv.includes("/api/config"));
    expect(canary?.argv).toEqual(["/bin/opencode", "api", "GET", "/api/config", "--standalone"]);
    expect(canary?.cwd).toBe(join(dataDir, "opencode-canary"));
    expect(canary?.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("1");
    expect(canary?.env.OPENCODE_CONFIG).toBe(undefined);
    const file = join(dataDir, "opencode-canary", "opencode.json");
    expect(existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null).toEqual({
      model: CANARY_MODEL,
    });
  });

  test("a newer version is available but not verified", async () => {
    const { deps: d } = deps({}, { "--version": "opencode v2.3.0" });
    expect(await discoverOpenCode({ enabled: true }, d)).toEqual({
      available: true,
      path: "/bin/opencode",
      version: "2.3.0",
      verified: false,
    });
  });

  test("each reason it is not available, and nothing runs when disabled or missing", async () => {
    const reason = async (config: { enabled: boolean }, d: DiscoveryDeps) =>
      (await discoverOpenCode(config, d)).reason ?? null;
    const disabled = deps();
    expect(await reason({ enabled: false }, disabled.deps)).toBe("opencode_disabled");
    expect(disabled.calls).toEqual([]);
    const missing = deps({ which: () => null });
    expect(await reason({ enabled: true }, missing.deps)).toBe("opencode_missing");
    expect(missing.calls).toEqual([]);
    expect(await reason({ enabled: true }, deps({}, { "--version": null }).deps)).toBe(
      "opencode_version_failed",
    );
    expect(await reason({ enabled: true }, deps({}, { "--version": "opencode v1.4.0" }).deps)).toBe(
      "opencode_v1",
    );
  });

  test("an unsafe global scope is reported with its findings, and the canary never runs", async () => {
    const findings = [
      {
        kind: "plugins_entry" as const,
        path: join(GLOBAL, "opencode.json"),
        detail: "x",
      },
    ];
    const { deps: d, calls } = deps({ scan: async () => ({ findings, fingerprint: "f" }) });
    const info = await discoverOpenCode({ enabled: true }, d);
    expect([info.available, info.reason, info.findings]).toEqual([
      false,
      "opencode_unsafe_global",
      findings,
    ]);
    expect(calls.some((c) => c.argv.includes("/api/config"))).toBe(false);
  });

  test("the global folder OpenCode reports must be the one the scope scan read", async () => {
    const elsewhere = JSON.stringify([{ type: "directory", path: "/elsewhere/opencode" }]);
    const moved = deps({}, { "api GET /api/config --standalone": elsewhere });
    expect(await discoverOpenCode({ enabled: true }, moved.deps)).toEqual({
      available: false,
      path: "/bin/opencode",
      version: "2.2.5",
      reason: "opencode_scope_mismatch",
    });
    const same = deps({}, { "api GET /api/config --standalone": sources() });
    expect((await discoverOpenCode({ enabled: true }, same.deps)).available).toBe(true);
  });

  test("any source but the global folder, its config files and our document fails the canary", async () => {
    const odd = JSON.stringify([
      { type: "directory", path: GLOBAL },
      { type: "document", path: "/private/tmp/canary/opencode.json" },
    ]);
    const { deps: d } = deps({}, { "api GET /api/config --standalone": odd });
    expect((await discoverOpenCode({ enabled: true }, d)).reason).toBe("opencode_scope_mismatch");
  });

  test("only 2.2.5 itself is verified; the version probe runs with the OpenCode env and 5 s", async () => {
    const { deps: d, calls } = deps({}, { "--version": "opencode v2.1.0" });
    const info = await discoverOpenCode({ enabled: true }, d);
    expect([info.available, info.verified]).toEqual([true, false]);
    const probe = calls.find((c) => c.argv.includes("--version"));
    expect([
      probe?.env.OPENCODE_DISABLE_PROJECT_CONFIG,
      probe?.env.OPENCODE_CONFIG,
      probe?.timeoutMs,
    ]).toEqual(["1", undefined, 5_000]);
  });

  test("the executable's size and time are kept, for the preflight to notice a replaced binary", async () => {
    const { deps: d } = deps({
      statFile: async (path) => (path === "/bin/opencode" ? "100:5" : null),
    });
    expect((await discoverOpenCode({ enabled: true }, d)).fingerprint).toBe("100:5");
  });

  test("the canary listed as a source means project config is not off; a failed canary is not available either", async () => {
    const probe = deps();
    const canaryFile = join(probe.dataDir, "opencode-canary", "opencode.json");
    probe.deps.run = async (argv) =>
      argv.includes("--version")
        ? { exitCode: 0, stdout: "opencode v2.2.5" }
        : { exitCode: 0, stdout: sources(canaryFile) };
    expect((await discoverOpenCode({ enabled: true }, probe.deps)).reason).toBe(
      "opencode_project_config_not_disabled",
    );
    const failed = deps({}, { "api GET /api/config --standalone": null });
    expect((await discoverOpenCode({ enabled: true }, failed.deps)).reason).toBe(
      "opencode_canary_failed",
    );
    const garbage = deps({}, { "api GET /api/config --standalone": "not json" });
    expect((await discoverOpenCode({ enabled: true }, garbage.deps)).reason).toBe(
      "opencode_canary_failed",
    );
  });
});
