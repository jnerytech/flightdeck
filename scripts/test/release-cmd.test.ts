import { describe, expect, test } from "bun:test";
import {
  bumpLock,
  bumpPackageJson,
  bumpVersaoTest,
  newer,
  type ReleaseDeps,
  release,
} from "../lib/release-cmd.ts";

const PACKAGES = ["packages/protocol", "apps/daemon", "apps/desktop"];
const VERSAO = "apps/daemon/test/versao.test.ts";
const BASELINE = "packages/protocol/surface-baseline.txt";
const PR_OPEN = "api repos/{owner}/{repo}/pulls?head={owner}:release-v0.37.0&state=open";

const pkg = (version: string) =>
  `{\n  "name": "@flightdeck/x",\n  "version": "${version}",\n  "private": true\n}\n`;
const lock = (version: string) =>
  [
    '    "apps/daemon": {',
    '      "name": "@flightdeck/daemon",',
    `      "version": "${version}",`,
    '      "dependencies": { "zod": "4.6.7", "version": "1.0.0" },',
    '    "apps/desktop": {',
    '      "name": "@flightdeck/desktop",',
    `      "version": "${version}",`,
    '    "packages/protocol": {',
    '      "name": "@flightdeck/protocol",',
    `      "version": "${version}",`,
    '    "left-pad": {',
    '      "name": "left-pad",',
    '      "version": "0.36.4",',
  ].join("\n");
const versao = (version: string) =>
  `test("share the product version, ${version}", () => {\n  expect(all).toEqual(["${version}", "${version}"]);\n  expect(DAEMON_VERSION).toBe("${version}");\n});\n`;

interface Opts {
  env?: Record<string, string>;
  dirty?: boolean;
  /** The version on origin/main, per package (default: all 0.36.4). */
  main?: Record<string, string>;
  tags?: string[];
  openPr?: string;
  /** The version test passes before the version moves (it must be red). */
  notRed?: boolean;
  surfaceLost?: boolean;
  baselineChanged?: boolean;
  fail?: RegExp;
}

/** A fake repository, GitHub and bun: every call is recorded, nothing real runs. */
function fake(opts: Opts = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const files = new Map<string, string>([
    ...PACKAGES.map((p) => [`${p}/package.json`, pkg("0.36.4")] as const),
    ["bun.lock", lock("0.36.4")],
    [VERSAO, versao("0.36.4")],
  ]);
  const versaoRuns: number[] = [];
  const ok = (stdout = "") => ({ code: 0, stdout });
  const bad = { code: 1, stdout: "" };
  const deps: ReleaseDeps = {
    git: async (args) => {
      const line = `git ${args.join(" ")}`;
      calls.push(line);
      if (opts.fail?.test(line)) return bad;
      if (args[0] === "status") {
        if (args.includes("--")) return ok(opts.baselineChanged ? ` M ${BASELINE}\n` : "");
        return ok(opts.dirty ? " M scripts/x.ts\n" : "");
      }
      if (args[0] === "show") {
        const path = (args[1] ?? "").replace("origin/main:", "").replace("/package.json", "");
        return ok(pkg(opts.main?.[path] ?? "0.36.4"));
      }
      if (args[0] === "rev-parse") {
        const tag = (args[3] ?? "").replace("refs/tags/", "");
        return opts.tags?.includes(tag) ? ok("sha") : bad;
      }
      return ok();
    },
    gh: async (args) => {
      const line = `gh ${args.join(" ")}`;
      calls.push(line);
      if (opts.fail?.test(line)) return bad;
      if (args[0] === "api" && args.includes("POST")) return ok("42 https://example.test/pull/42");
      if (args[0] === "api") return ok(opts.openPr ?? "");
      return ok();
    },
    bun: async (args) => {
      const line = `bun ${args.join(" ")}`;
      calls.push(line);
      if (opts.fail?.test(line)) return bad;
      if (args.includes(VERSAO)) {
        versaoRuns.push(1);
        if (opts.notRed) return ok();
        return versaoRuns.length === 1 ? bad : ok();
      }
      if (args.includes("scripts/protocol-surface.ts") && !args.includes("--write")) {
        return opts.surfaceLost ? bad : ok();
      }
      return ok();
    },
    read: (path) => files.get(path) ?? "",
    write: (path, text) => {
      calls.push(`write ${path}`);
      files.set(path, text);
    },
    env: { FLIGHTDECK_COORDINATOR: "1", ...opts.env },
    log: (line) => logs.push(line),
  };
  return { deps, calls, logs, files };
}

const at = (calls: string[], needle: string) => calls.findIndex((c) => c.includes(needle));
const pushed = (calls: string[]) => calls.some((c) => c.startsWith("git push"));

describe("the version helpers", () => {
  test("bumpPackageJson moves the version of a package.json and nothing else", () => {
    const text = `{\n  "version": "0.36.4",\n  "dependencies": { "x": "0.36.4" }\n}\n`;
    expect(bumpPackageJson(text, "0.36.4", "0.37.0")).toBe(
      `{\n  "version": "0.37.0",\n  "dependencies": { "x": "0.36.4" }\n}\n`,
    );
  });

  test("bumpLock moves the version of the three workspaces and no package", () => {
    const out = bumpLock(lock("0.36.4"), "0.36.4", "0.37.0");
    expect(out).toBe(
      lock("0.37.0").replace(
        '"name": "left-pad",\n      "version": "0.37.0"',
        '"name": "left-pad",\n      "version": "0.36.4"',
      ),
    );
    expect(out.match(/"version": "0\.37\.0"/g)?.length).toBe(3);
    expect(out).toContain('"left-pad",\n      "version": "0.36.4"');
  });

  test("bumpVersaoTest moves every mention of the product version", () => {
    expect(bumpVersaoTest(versao("0.36.4"), "0.36.4", "0.37.0")).toBe(versao("0.37.0"));
  });

  test("newer compares numbers, not text", () => {
    expect(newer("0.37.0", "0.36.4")).toBe(true);
    expect(newer("0.36.10", "0.36.9")).toBe(true);
    expect(newer("1.0.0", "0.99.99")).toBe(true);
    expect(newer("0.36.4", "0.36.4")).toBe(false);
    expect(newer("0.36.3", "0.36.4")).toBe(false);
  });
});

describe("release: who and what", () => {
  test("outside the coordinator's session it refuses and touches nothing", async () => {
    const { deps, calls, logs } = fake({ env: { FLIGHTDECK_COORDINATOR: "" } });
    expect(await release(["v0.37.0"], deps)).toBe(2);
    expect(calls).toEqual([]);
    expect(logs.join("\n")).toContain("coordinator");
  });

  test("a tag that is not v<x.y.z> is a usage error", async () => {
    const { deps, calls, logs } = fake();
    expect(await release(["0.37.0"], deps)).toBe(2);
    expect(await release([], deps)).toBe(2);
    expect(calls).toEqual([]);
    expect(logs.join("\n")).toContain("usage");
  });

  test("a dirty working tree is refused before anything is read or written", async () => {
    const { deps, calls, logs } = fake({ dirty: true });
    expect(await release(["v0.37.0"], deps)).toBe(2);
    expect(calls.filter((c) => c.startsWith("write"))).toEqual([]);
    expect(pushed(calls)).toBe(false);
    expect(logs.join("\n")).toContain("not clean");
  });

  test("packages at different versions on main are refused", async () => {
    const { deps, calls, logs } = fake({ main: { "apps/daemon": "0.36.3" } });
    expect(await release(["v0.37.0"], deps)).toBe(2);
    expect(calls.some((c) => c.startsWith("write"))).toBe(false);
    expect(logs.join("\n")).toContain("apps/daemon");
  });

  test("a version that is not newer than main's is refused", async () => {
    const { deps, calls, logs } = fake();
    expect(await release(["v0.36.3"], deps)).toBe(2);
    expect(calls.some((c) => c.startsWith("write"))).toBe(false);
    expect(logs.join("\n")).toContain("not newer");
  });
});

describe("release: the bump and its PR", () => {
  test("test(versao) red, then chore(versao) green, the surface, the push, the PR and auto-merge, in order", async () => {
    const { deps, calls, files, logs } = fake({ baselineChanged: true });
    expect(await release(["v0.37.0"], deps)).toBe(0);
    const order = [
      "git fetch origin main",
      "git switch -c release-v0.37.0 origin/main",
      `write ${VERSAO}`,
      `bun --config=bunfig.area.toml test ${VERSAO}`,
      `git add -- ${VERSAO}`,
      "git commit -m test(versao): the product version is 0.37.0 (red: the packages say 0.36.4) (#275)",
      "write packages/protocol/package.json",
      "write bun.lock",
      "git commit -m chore(versao): protocol, daemon and desktop go to 0.37.0 (#275)",
      "bun run scripts/protocol-surface.ts",
      "bun run scripts/protocol-surface.ts --write",
      `git add -- ${BASELINE}`,
      "git commit -m chore(release): the protocol surface baseline of v0.37.0 (#275)",
      "git push -u origin release-v0.37.0",
      "bun run pr -- auto 42",
    ];
    const places = order.map((needle) => at(calls, needle));
    expect(places.filter((p) => p < 0)).toEqual([]);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    expect(files.get(VERSAO)).toBe(versao("0.37.0"));
    for (const p of PACKAGES) expect(files.get(`${p}/package.json`)).toBe(pkg("0.37.0"));
    expect(files.get("bun.lock")).toBe(bumpLock(lock("0.36.4"), "0.36.4", "0.37.0"));
    expect(logs.join("\n")).toContain("#42");
  });

  test("the version test is committed before the packages move, with a red run in between", async () => {
    const { deps, calls } = fake();
    await release(["v0.37.0"], deps);
    const firstPackage = at(calls, "write packages/protocol/package.json");
    const redRun = at(calls, `test ${VERSAO}`);
    const testCommit = at(calls, "git commit -m test(versao)");
    expect(redRun).toBeGreaterThan(-1);
    expect(testCommit).toBeGreaterThan(redRun);
    expect(firstPackage).toBeGreaterThan(testCommit);
    expect(calls.filter((c) => c.includes(`test ${VERSAO}`)).length).toBe(2);
  });

  test("the PR is made by the command, titled for the release and never closing an issue", async () => {
    const { deps, calls } = fake();
    await release(["v0.37.0"], deps);
    const post = calls.find((c) => c.startsWith("gh api") && c.includes("POST")) ?? "";
    expect(post).toContain("head=release-v0.37.0");
    expect(post).toContain("base=main");
    expect(post).toContain("title=chore(versao): v0.37.0");
    expect(post.toLowerCase()).not.toContain("closes");
  });

  test("an unchanged surface baseline adds no commit", async () => {
    const { deps, calls } = fake({ baselineChanged: false });
    expect(await release(["v0.37.0"], deps)).toBe(0);
    expect(calls.some((c) => c.includes("chore(release)"))).toBe(false);
    expect(pushed(calls)).toBe(true);
  });

  test("a version test that is already green before the bump stops the release", async () => {
    const { deps, calls, logs } = fake({ notRed: true });
    expect(await release(["v0.37.0"], deps)).toBe(1);
    expect(pushed(calls)).toBe(false);
    expect(calls.some((c) => c.startsWith("git commit"))).toBe(false);
    expect(logs.join("\n")).toContain("red");
  });

  test("a surface that lost lines stops the release before the push", async () => {
    const { deps, calls, logs } = fake({ surfaceLost: true });
    expect(await release(["v0.37.0"], deps)).toBe(1);
    expect(pushed(calls)).toBe(false);
    expect(calls.some((c) => c.includes("--write"))).toBe(false);
    expect(logs.join("\n")).toContain("surface");
  });

  test("a branch that cannot be made stops the release", async () => {
    const { deps, calls, logs } = fake({ fail: /^git switch/ });
    expect(await release(["v0.37.0"], deps)).toBe(1);
    expect(calls.some((c) => c.startsWith("write"))).toBe(false);
    expect(logs.join("\n")).toContain("release-v0.37.0");
  });

  test("a failed push says the PR was not opened", async () => {
    const { deps, calls, logs } = fake({ fail: /^git push/ });
    expect(await release(["v0.37.0"], deps)).toBe(1);
    expect(calls.some((c) => c.includes("POST"))).toBe(false);
    expect(logs.join("\n")).toContain("push");
  });

  test("a PR GitHub refuses stops before auto-merge", async () => {
    const { deps, calls } = fake({ fail: /POST/ });
    expect(await release(["v0.37.0"], deps)).toBe(1);
    expect(calls.some((c) => c.includes("pr -- auto"))).toBe(false);
  });

  test("a release PR that is open already is waited for, with nothing written", async () => {
    const { deps, calls, logs } = fake({ openPr: "40\n" });
    expect(await release(["v0.37.0"], deps)).toBe(0);
    expect(calls.some((c) => c.startsWith("write") || c.startsWith("git switch"))).toBe(false);
    expect(pushed(calls)).toBe(false);
    expect(calls.some((c) => c.includes(PR_OPEN))).toBe(true);
    expect(logs.join("\n")).toContain("#40");
  });
});

describe("release: after the PR merged", () => {
  const merged = {
    main: { "packages/protocol": "0.37.0", "apps/daemon": "0.37.0", "apps/desktop": "0.37.0" },
  };

  test("checks the surface, tags and closes, in that order, writing nothing", async () => {
    const { deps, calls } = fake(merged);
    expect(await release(["v0.37.0"], deps)).toBe(0);
    const order = [
      "bun run scripts/protocol-surface.ts",
      "bun run pr -- tag v0.37.0",
      "bun run release:close -- v0.37.0 --apply",
    ];
    const places = order.map((needle) => at(calls, needle));
    expect(places.filter((p) => p < 0)).toEqual([]);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    expect(calls.some((c) => c.startsWith("write") || c.startsWith("git switch"))).toBe(false);
    expect(pushed(calls)).toBe(false);
  });

  test("a surface that lost lines stops before the tag", async () => {
    const { deps, calls } = fake({ ...merged, surfaceLost: true });
    expect(await release(["v0.37.0"], deps)).toBe(1);
    expect(calls.some((c) => c.includes("pr -- tag"))).toBe(false);
  });

  test("a tag the CI gate refuses is its exit code, and nothing is closed", async () => {
    const { deps, calls, logs } = fake({ ...merged });
    const refusing: ReleaseDeps = {
      ...deps,
      bun: async (args) => {
        const result = await deps.bun(args);
        return args.includes("tag") ? { code: 2, stdout: "" } : result;
      },
    };
    expect(await release(["v0.37.0"], refusing)).toBe(2);
    expect(calls.some((c) => c.includes("release:close"))).toBe(false);
    expect(logs.join("\n")).toContain("not tagged");
  });

  test("a tag that exists is not made again, and the issues are still closed", async () => {
    const { deps, calls } = fake({ ...merged, tags: ["v0.37.0"] });
    expect(await release(["v0.37.0"], deps)).toBe(0);
    expect(calls.some((c) => c.includes("pr -- tag"))).toBe(false);
    expect(calls.some((c) => c.includes("release:close -- v0.37.0 --apply"))).toBe(true);
  });

  test("a failed release:close is its exit code", async () => {
    const { deps } = fake({ ...merged, fail: /release:close/ });
    expect(await release(["v0.37.0"], deps)).toBe(1);
  });
});
