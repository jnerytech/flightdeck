import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ciPlan, FULL, planOutputs, selectionBase } from "../lib/ci-paths.ts";

/**
 * #264: a pull request runs only the jobs its paths need; main, a run by hand and a diff that
 * cannot be read run everything; a job skipped by path still reports under the ruleset's name.
 */
const ROOT = resolve(import.meta.dir, "../..");

interface Step {
  id?: string;
  name?: string;
  run?: string;
  if?: string;
  "timeout-minutes"?: number;
  uses?: string;
  with?: Record<string, string>;
}
interface Job {
  name?: string;
  if?: string;
  needs?: string[];
  outputs?: Record<string, string>;
  strategy?: { matrix?: Record<string, unknown[]> };
  steps: Step[];
}
const ci = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
  jobs: Record<string, Job>;
};
const job = (key: string): Job => ci.jobs[key] ?? { steps: [] };
const step = (key: string, name: string) => job(key).steps.find((s) => s.name === name);
const runs = (key: string) =>
  job(key)
    .steps.map((s) => s.run ?? "")
    .join("\n");
const gate = (output: string) => `needs.quick.outputs.${output} == 'true'`;
const PR = "pull_request";
const NONE = {
  windows: false,
  smokes: false,
  screenshots: false,
  cargo: false,
  e2e: false,
  windowsShards: 1,
};

describe("ci-paths: the rules", () => {
  test("docs only run the Linux tests and lint, nothing else", () => {
    expect(ciPlan(PR, ["docs/TDD.md", "README.md"])).toEqual(NONE);
    expect(ciPlan(PR, [])).toEqual(NONE);
  });

  test("scripts add the Windows shards, which run the tests related to them (#399: #383 changed only scripts/test and broke Windows)", () => {
    const windows = { ...NONE, windows: true };
    expect(ciPlan(PR, ["scripts/lib/slot.ts", "scripts/test/slot.test.ts"])).toEqual(windows);
    // A test helper the demo seed loads (fake CLIs) plans the journeys as well (#410 review).
    expect(ciPlan(PR, ["scripts/test/fake-cli-main.ts"])).toEqual({ ...windows, e2e: true });
  });

  test("the UI, the journeys, their config or the demo add the e2e journeys (#399)", () => {
    for (const path of [
      "scripts/e2e/define-journeys.ts",
      "scripts/lib/e2e-config.ts",
      "scripts/lib/e2e-demo.ts",
      "scripts/demo.ts",
      "scripts/demo-seed.ts",
      "playwright.config.ts",
    ]) {
      expect(`${path}: ${ciPlan(PR, [path]).e2e}`).toBe(`${path}: true`);
    }
    expect(ciPlan(PR, ["apps/desktop/src/ui/App.tsx"]).e2e).toBe(true);
    // The demo the journeys drive starts the real daemon (scripts/demo-seed.ts, #410 review).
    expect(ciPlan(PR, ["apps/daemon/src/main.ts"]).e2e).toBe(true);
    expect(ciPlan(PR, ["apps/daemon/test/workflow-helpers.ts"]).e2e).toBe(true);
    expect(ciPlan(PR, ["scripts/test/fake-cli.ts"]).e2e).toBe(true);
    expect(ciPlan(PR, ["scripts/test/slot.test.ts"]).e2e).toBe(false);
    expect(ciPlan(PR, ["scripts/lib/slot.ts"]).e2e).toBe(false);
  });

  test("the daemon or a smoke adds Windows and the smokes", () => {
    // The demo the journeys drive starts the real daemon, so the daemon plans them too (#410 review).
    const daemon = { ...NONE, windows: true, smokes: true, e2e: true };
    expect(ciPlan(PR, ["apps/daemon/src/main.ts"])).toEqual(daemon);
    // A smoke is no part of the demo: Windows and the smokes, not the journeys.
    expect(ciPlan(PR, ["scripts/smoke-limits.ts"])).toEqual({ ...daemon, e2e: false });
  });

  test("the app, the protocol, the dependencies or the workflow run everything but cargo", () => {
    // A file every test reads also runs the whole suite on Windows, in three shards (#444).
    for (const [path, windowsShards] of [
      ["apps/desktop/src/ui/App.tsx", 1],
      ["packages/protocol/src/index.ts", 1],
      ["package.json", 3],
      ["bun.lock", 3],
      ["bunfig.toml", 3],
      ["tsconfig.base.json", 3],
      [".github/workflows/ci.yml", 1],
    ] as const) {
      const all = { ...FULL, cargo: false, windowsShards };
      expect(`${path}: ${JSON.stringify(ciPlan(PR, [path]))}`).toBe(
        `${path}: ${JSON.stringify(all)}`,
      );
    }
  });

  test("the Tauri shell runs everything and cargo", () => {
    expect(ciPlan(PR, ["apps/desktop/src-tauri/src/lib.rs"])).toEqual({
      ...FULL,
      windowsShards: 1,
    });
  });

  test("the schedule, a run by hand or a diff that cannot be read runs everything", () => {
    expect(ciPlan("schedule", ["docs/TDD.md"])).toEqual(FULL);
    expect(ciPlan("workflow_dispatch", [])).toEqual(FULL);
    expect(ciPlan(PR, null)).toEqual(FULL);
    expect(ciPlan("push", null)).toEqual(FULL);
  });

  test("a push to main plans by its paths, like a PR (#444): the full run is the schedule's", () => {
    expect(ciPlan("push", ["docs/TDD.md"])).toEqual(NONE);
    expect(ciPlan("push", ["apps/daemon/src/main.ts"])).toEqual({
      ...NONE,
      windows: true,
      smokes: true,
      e2e: true,
    });
    expect(ciPlan("push", ["bun.lock"]).windowsShards).toBe(3);
  });

  test("the selection's base: the PR's target, the commit a push came after, none for a full run (#444)", () => {
    expect(selectionBase("pull_request", "main", "")).toBe("origin/main");
    expect(selectionBase("push", "", "0123456789abcdef0123456789abcdef01234567")).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
    // A new branch's push has no before (all zeros), and a garbled one is no commit.
    expect(selectionBase("push", "", "0000000000000000000000000000000000000000")).toBe("");
    expect(selectionBase("push", "", "main; rm -rf /")).toBe("");
    expect(selectionBase("push", "", "")).toBe("");
    expect(selectionBase("schedule", "", "abc")).toBe("");
    expect(selectionBase("workflow_dispatch", "", "")).toBe("");
    expect(selectionBase("pull_request", "", "")).toBe("");
  });

  test("every file the demo seed imports plans the journeys, so a change the journeys run cannot skip them (#410 review)", () => {
    const seed = readFileSync(join(ROOT, "scripts/demo-seed.ts"), "utf8");
    const local = [...seed.matchAll(/from "(\.{1,2}\/[^"]+)"/g)].map((m) =>
      join("scripts", m[1] ?? "").replaceAll("\\", "/"),
    );
    expect(local.length).toBeGreaterThan(3);
    for (const path of local) expect(`${path}: ${ciPlan(PR, [path]).e2e}`).toBe(`${path}: true`);
  });

  test("a PR's Windows tests take one shard, three when the whole suite runs: a file every test reads changed, or a test went away (#444)", () => {
    expect(ciPlan(PR, ["scripts/lib/slot.ts"]).windowsShards).toBe(1);
    expect(ciPlan(PR, ["apps/daemon/src/main.ts"]).windowsShards).toBe(1);
    for (const path of [
      "bun.lock",
      "package.json",
      "bunfig.area.toml",
      "scripts/test/preload.ts",
    ]) {
      expect(`${path}: ${ciPlan(PR, [path]).windowsShards}`).toBe(`${path}: 3`);
    }
    const gone = "apps/daemon/test/gone.test.ts";
    expect(ciPlan(PR, [gone], [gone]).windowsShards).toBe(3);
    expect(ciPlan(PR, ["apps/daemon/src/gone.ts"], ["apps/daemon/src/gone.ts"]).windowsShards).toBe(
      1,
    );
    expect(ciPlan("schedule", ["docs/TDD.md"]).windowsShards).toBe(3);
  });

  test("the plan becomes one GitHub output per job group", () => {
    expect(planOutputs({ ...NONE, windows: true })).toBe(
      "windows=true\nsmokes=false\nscreenshots=false\ncargo=false\ne2e=false\nwindows_shards=[1]\n",
    );
    expect(planOutputs(FULL)).toContain("windows_shards=[1,2,3]\n");
  });
});

describe("ci-paths: the workflow", () => {
  test("the quick job computes the plan first, and every job group reads it from there (#444: no changes job of its own)", () => {
    expect(ci.jobs.changes).toBeUndefined();
    const first = job("quick").steps.findIndex((s) =>
      (s.run ?? "").includes("bun run scripts/ci-paths.ts"),
    );
    const typecheck = job("quick").steps.findIndex((s) => s.name === "Typecheck");
    expect(first >= 0 && first < typecheck).toBe(true);
    expect(job("quick").steps[first]?.id).toBe("plan");
    expect(Object.keys(job("quick").outputs ?? {})).toEqual([
      "windows",
      "smokes",
      "screenshots",
      "cargo",
      "e2e",
      "windows_shards",
      "base",
    ]);
    for (const key of ["test-windows-shard", "checks-windows"]) {
      expect(job(key).needs).toContain("quick");
      expect(job(key).if ?? "").toContain(gate("windows"));
    }
    expect(job("screenshots-prints").needs).toContain("quick");
    expect(job("screenshots-prints").if ?? "").toContain(gate("screenshots"));
    expect(job("screenshots-e2e").needs).toContain("quick");
    expect(job("screenshots-e2e").if ?? "").toContain(gate("e2e"));
    expect(step("checks-linux", "Smokes")?.if).toBe(gate("smokes"));
  });

  test("the Tauri system libraries step has its own deadline and retries once, with a fresh apt-get update", () => {
    // A slow mirror once took 29 minutes here and the job hit its 45-minute limit.
    const apt = step("checks-linux", "System libraries of the Tauri shell (Linux)");
    expect(apt?.["timeout-minutes"]).toBe(10);
    const script = apt?.run ?? "";
    // Each attempt has its own limit, so a hung first one still leaves time for the retry.
    expect(script).toMatch(/timeout \d+ sudo apt-get update/);
    expect(script).toMatch(/timeout \d+ sudo apt-get install -y/);
    expect(script).toContain("install_libs || install_libs");
  });

  test("the Tauri system packages come from a cache keyed on their list, before the mirror (#405)", () => {
    const steps = job("checks-linux").steps;
    const at = (name: string) => steps.findIndex((s) => s.name === name);
    const cache = step("checks-linux", "Cache of the Tauri system packages");
    const apt = step("checks-linux", "System libraries of the Tauri shell (Linux)");
    // Pinned by commit, gated like the install, and before it.
    expect(cache?.uses ?? "").toMatch(/^actions\/cache@[0-9a-f]{40}$/);
    const raw = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(raw).toMatch(new RegExp(`${cache?.uses} # v4\\.\\d+\\.\\d+`));
    expect(cache?.if).toBe(apt?.if);
    expect(at("Cache of the Tauri system packages")).toBeLessThan(
      at("System libraries of the Tauri shell (Linux)"),
    );
    expect(cache?.with?.path).toBe("~/.cache/tauri-debs");
    // Keyed on the runner image too: an image update must not get older packages over newer ones.
    const image = step("checks-linux", "Runner image of the Tauri package cache");
    expect(image?.if).toBe(apt?.if);
    expect(image?.run ?? "").toContain('"version=$ImageOS-$ImageVersion" >> "$GITHUB_OUTPUT"');
    expect(at("Runner image of the Tauri package cache")).toBeLessThan(
      at("Cache of the Tauri system packages"),
    );
    expect(cache?.with?.key).toBe(
      "tauri-debs-${{ runner.os }}-${{ runner.arch }}-${{ steps.tauri-image.outputs.version }}-${{ hashFiles('.github/tauri-apt-packages.txt') }}",
    );
    // A hit installs the saved packages with no mirror; anything else falls back to apt, which
    // downloads into the cached folder.
    const script = apt?.run ?? "";
    expect(script).toContain('sudo dpkg -i "$debs"/*.deb');
    expect(script.indexOf("dpkg -i")).toBeLessThan(script.indexOf("install_libs || install_libs"));
    expect(script).toContain('-o Dir::Cache::archives="$debs"');
    // apt writes the files as root: the cache's save, which runs as the runner user, must read them.
    expect(script).toContain('sudo chown -R "$(id -u):$(id -g)" "$debs"');
    expect(script).toContain(".github/tauri-apt-packages.txt");
    // The list is one file, read by both the key and the install.
    const list = readFileSync(join(ROOT, ".github/tauri-apt-packages.txt"), "utf8");
    expect(list.split(/\s+/).filter(Boolean)).toEqual([
      "pkg-config",
      "libwebkit2gtk-4.1-dev",
      "libgtk-3-dev",
      "libayatana-appindicator3-dev",
      "librsvg2-dev",
      "libsoup-3.0-dev",
    ]);
  });

  test("cargo runs only when the plan says so, after rust-cache", () => {
    for (const key of ["checks-linux", "checks-windows"]) {
      const steps = job(key).steps;
      const cache = steps.findIndex((s) => (s.uses ?? "").startsWith("Swatinem/rust-cache@"));
      const cargo = steps.findIndex((s) => (s.run ?? "").includes("cargo check"));
      expect(`${key}: ${cache >= 0 && cache < cargo}`).toBe(`${key}: true`);
      expect(steps[cache]?.uses).toMatch(/^Swatinem\/rust-cache@[0-9a-f]{40}$/);
      expect(steps[cache]?.if).toBe(gate("cargo"));
      expect(steps[cargo]?.if ?? "").toContain(gate("cargo"));
    }
  });

  test("the e2e journeys run in three Playwright shards, each with its own artifacts", () => {
    expect(job("screenshots-e2e").strategy?.matrix?.shard).toEqual([1, 2, 3]);
    expect(runs("screenshots-e2e")).toContain("bun run e2e -- --shard=${{ matrix.shard }}/3");
    const names = job("screenshots-e2e")
      .steps.map((s) => s.with?.name ?? "")
      .filter(Boolean);
    expect(names).toEqual([
      "relatorio-e2e-${{ matrix.shard }}",
      "e2e-failures-${{ matrix.shard }}",
    ]);
  });

  test("the required aggregates succeed when their jobs were skipped by path, and fail otherwise", () => {
    for (const [key, output] of [
      ["test-windows", "windows"],
      ["screenshots", "screenshots"],
    ] as const) {
      expect(job(key).needs?.[0]).toBe("quick");
      // A failed plan has no outputs: it must fail the check, never read as "skipped".
      const check = runs(key);
      const planned = check.indexOf('test "${{ needs.quick.result }}" = success');
      expect(planned >= 0 && planned < check.indexOf("skipped by path")).toBe(true);
      expect(runs(key)).toContain(`if [ "\${{ needs.quick.outputs.${output} }}" != true ]; then`);
      expect(runs(key)).toContain("skipped by path");
    }
  });

  test("no job runs the local Sonar: SonarCloud Code Analysis on the PR is the only Sonar check (#283)", () => {
    for (const [key, ciJob] of Object.entries(ci.jobs)) {
      const sonar = ciJob.steps.filter((s) => (s.run ?? "").includes("lint:sonar"));
      expect(`${key}: ${sonar.length}`).toBe(`${key}: 0`);
    }
  });
});
