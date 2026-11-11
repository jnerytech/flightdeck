import { describe, expect, test } from "bun:test";
import {
  changeCounts,
  coupling,
  hotspots,
  isSource,
  type LogCommit,
  parseLog,
} from "../../lib/metrics/git-log.ts";
import { buildSnapshot, type MetricsDeps, parseRatchetRows } from "../../lib/metrics/snapshot.ts";

/**
 * Issue #1949 (task 1): the git-based metrics and the ratchets of a release snapshot. Git is a fake
 * that answers by its arguments; nothing reads a real repository.
 */

const RS = "\u001e";
const US = "\u001f";
/** The text of `git log --format=%x1e%H%x1f%cI%x1f%s --name-only` for these commits. */
const logText = (commits: LogCommit[]) =>
  commits
    .map((c) => `${RS}${c.hash}${US}${c.date}${US}${c.subject}\n\n${c.files.join("\n")}\n`)
    .join("");
const commit = (hash: string, date: string, files: string[], subject = "feat: x"): LogCommit => ({
  hash,
  date,
  subject,
  files,
});

describe("metrics: reading git log", () => {
  test("parseLog gives each commit its hash, date, subject and files, and keeps a commit with no files", () => {
    const commits = [
      commit("aaa", "2026-11-01T10:00:00+00:00", ["a.ts", "dir/b.ts"], "feat(x): one"),
      commit("bbb", "2026-11-02T10:00:00+00:00", [], "chore: empty"),
    ];
    expect(parseLog(logText(commits))).toEqual(commits);
    expect(parseLog("")).toEqual([]);
  });

  test("isSource counts .ts, .tsx and .rs, and leaves out tests, declarations and the vendored UI", () => {
    const yes = [
      "apps/daemon/src/main.ts",
      "apps/desktop/src/App.tsx",
      "apps/desktop/src-tauri/src/lib.rs",
    ];
    const no = [
      "apps/daemon/test/board/x.test.ts",
      "apps/desktop/test/App.test.tsx",
      "scripts/test/release/x.ts",
      "scripts/e2e/journeys.e2e.ts",
      "apps/desktop/src/vite-env.d.ts",
      "apps/desktop/src/components/ui/button.tsx",
      "README.md",
      "package.json",
    ];
    expect([yes.map(isSource), no.map(isSource)]).toEqual([
      [true, true, true],
      no.map(() => false),
    ]);
  });
});

describe("metrics: hotspots and coupling", () => {
  const commits = [
    commit("1", "2026-11-01T00:00:00Z", ["src/big.ts", "src/small.ts", "src/x.test.ts"]),
    commit("2", "2026-11-02T00:00:00Z", ["src/big.ts"]),
    commit("3", "2026-11-03T00:00:00Z", ["src/small.ts", "README.md"]),
    commit("4", "2026-11-04T00:00:00Z", ["src/big.ts", "src/small.ts"]),
  ];

  test("changeCounts counts commits per source file, most first, ties by path", () => {
    expect(changeCounts(commits)).toEqual([
      { path: "src/big.ts", commits: 3 },
      { path: "src/small.ts", commits: 3 },
    ]);
  });

  test("hotspots rank by commits times lines, the top few, with no test file", () => {
    const lines = new Map([
      ["src/big.ts", 1000],
      ["src/small.ts", 10],
    ]);
    const ranked = hotspots(changeCounts(commits), lines, 1);
    expect(ranked).toEqual([{ path: "src/big.ts", commits: 3, lines: 1000, score: 3000 }]);
    // A file that is gone at the tag has no line count and is left out.
    expect(hotspots([{ path: "src/gone.ts", commits: 9 }], new Map(), 5)).toEqual([]);
  });

  test("coupling lists pairs with enough commits together, skips bulk commits and test files", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      commit(`c${i}`, "2026-11-01T00:00:00Z", ["src/a.ts", "src/b.ts", "src/a.test.ts"]),
    );
    const bulk = commit(
      "bulk",
      "2026-11-01T00:00:00Z",
      Array.from({ length: 31 }, (_, i) => `src/f${i}.ts`),
    );
    const pairs = coupling([...many, bulk, bulk, bulk, bulk, bulk, bulk], {
      minSupport: 5,
      maxFiles: 30,
      limit: 15,
    });
    expect(pairs).toEqual([{ a: "src/a.ts", b: "src/b.ts", commits: 6 }]);
    expect(coupling(many.slice(0, 4), { minSupport: 5, maxFiles: 30, limit: 15 })).toEqual([]);
  });
});

/** A fake git over a small history: two tags, v1 and v2, and a file's text at the tag. */
function fakeGit(opts: { previous?: boolean; archRows?: boolean } = {}) {
  const calls: string[][] = [];
  const commits = [
    commit("c3", "2026-11-10T09:00:00Z", ["src/big.ts", "src/small.ts"], "feat: three"),
    commit("c2", "2026-11-05T09:00:00Z", ["src/big.ts"], "fix: two"),
    commit("c1", "2026-09-01T09:00:00Z", ["src/big.ts", "src/old.ts"], "feat: one"),
  ];
  const deps: MetricsDeps = {
    git: async (args) => {
      calls.push(args);
      const [cmd, a1, a2] = args;
      if (cmd === "rev-parse") return { code: 0, stdout: "deadbeef\n" };
      if (cmd === "describe") {
        return opts.previous === false
          ? { code: 128, stdout: "" }
          : { code: 0, stdout: "v0.1.0\n" };
      }
      if (cmd === "log" && a1 === "-1") {
        // The date of a tag: v0.2.0 the 15th, v0.1.0 the 1st.
        return {
          code: 0,
          stdout: `${args.includes("v0.1.0") ? "2026-11-01" : "2026-11-15"}T00:00:00+00:00\n`,
        };
      }
      if (cmd === "log") {
        const since = args.find((arg) => arg.startsWith("--since="));
        const range = args.find((arg) => arg.includes(".."));
        const keep = commits.filter((c) => {
          if (range) return c.date > "2026-11-01"; // after v0.1.0
          if (since) return c.date >= since.slice("--since=".length);
          return true;
        });
        return { code: 0, stdout: logText(keep) };
      }
      if (cmd === "show") {
        const path = String(a1).split(":")[1];
        const text =
          path === "src/big.ts"
            ? "x\n".repeat(500)
            : path === "src/small.ts"
              ? "x\n".repeat(20)
              : null;
        return text === null ? { code: 128, stdout: "" } : { code: 0, stdout: text };
      }
      void a2;
      return { code: 1, stdout: "" };
    },
    arch: async () =>
      opts.archRows === false ? null : [{ ratchet: "knip files", baseline: 15, today: 14 }],
    now: () => new Date("2026-11-16T12:00:00Z"),
  };
  return { deps, calls };
}

describe("metrics: the snapshot", () => {
  test("with two tags it has the schema, both windows, the hotspots and the ratchets", async () => {
    const { deps } = fakeGit();
    const snapshot = (await buildSnapshot(deps, "v0.2.0")) as Record<string, any>;
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      tag: "v0.2.0",
      version: "0.2.0",
      commit: "deadbeef",
      generatedAt: "2026-11-16T12:00:00.000Z",
      window: { previousTag: "v0.1.0", previousTagDate: "2026-11-01T00:00:00+00:00", days: 30 },
    });
    expect(snapshot.hotspots.sinceRelease.map((h: { path: string }) => h.path)).toEqual([
      "src/big.ts",
      "src/small.ts",
    ]);
    expect(snapshot.hotspots.sinceRelease[0]).toEqual({
      path: "src/big.ts",
      commits: 2,
      lines: 500,
      score: 1000,
    });
    // The last 30 days before the tag (the 15th) start on the 16th of October: c1 is older.
    expect(snapshot.hotspots.last30Days[0].commits).toBe(2);
    expect(snapshot.coupling).toEqual({ sinceRelease: [], last30Days: [] });
    expect(snapshot.ratchets).toEqual([{ ratchet: "knip files", baseline: 15, today: 14 }]);
    for (const key of ["coverage", "ciHealth", "prSize", "mainRed"])
      expect(key in snapshot).toBe(true);
  });

  test("with no previous tag every sinceRelease is null and last30Days is filled", async () => {
    const { deps } = fakeGit({ previous: false });
    const snapshot = (await buildSnapshot(deps, "v0.2.0")) as Record<string, any>;
    expect(snapshot.window).toEqual({ previousTag: null, previousTagDate: null, days: 30 });
    expect(snapshot.hotspots.sinceRelease).toBeNull();
    expect(snapshot.coupling.sinceRelease).toBeNull();
    expect(snapshot.hotspots.last30Days.length).toBeGreaterThan(0);
  });

  test("a ratchet report that could not be made is null and named in unavailable, the rest still written", async () => {
    const { deps } = fakeGit({ archRows: false });
    const snapshot = (await buildSnapshot(deps, "v0.2.0")) as Record<string, any>;
    expect(snapshot.ratchets).toBeNull();
    expect(snapshot.unavailable.map((u: { metric: string }) => u.metric)).toContain("ratchets");
    expect(snapshot.hotspots.last30Days.length).toBeGreaterThan(0);
  });

  test("the metrics of a later task are null and say so, never zero", async () => {
    const { deps } = fakeGit();
    const snapshot = (await buildSnapshot(deps, "v0.2.0")) as Record<string, any>;
    const names = snapshot.unavailable.map((u: { metric: string }) => u.metric);
    expect([snapshot.coverage, snapshot.ciHealth, snapshot.prSize, snapshot.mainRed]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(names).toEqual(expect.arrayContaining(["coverage", "ciHealth", "prSize", "mainRed"]));
  });

  test("an unknown tag is refused", async () => {
    const { deps } = fakeGit();
    const failing: MetricsDeps = {
      ...deps,
      git: async (args) => (args[0] === "rev-parse" ? { code: 128, stdout: "" } : deps.git(args)),
    };
    await expect(buildSnapshot(failing, "v9.9.9")).rejects.toThrow("tag");
  });
});

describe("metrics: the ratchet report", () => {
  test("parseRatchetRows reads the rows arch-report writes and refuses anything else", () => {
    const rows = [{ ratchet: "knip files", baseline: 15, today: 14 }];
    expect(parseRatchetRows(JSON.stringify(rows))).toEqual(rows);
    expect(parseRatchetRows("not json")).toBeNull();
    expect(parseRatchetRows('{"a":1}')).toBeNull();
    expect(parseRatchetRows('[{"ratchet":"x","baseline":"1","today":2}]')).toBeNull();
  });
});
