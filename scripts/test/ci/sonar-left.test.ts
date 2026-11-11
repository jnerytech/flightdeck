import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Fetched, sonarLeft } from "../../lib/sonar-left.ts";
import { realTempDir } from "../temp-dir.ts";

/**
 * Issue #1477: Sonar's open findings, with the ones main changed since its last analysis marked.
 * The fetch is a fake that answers by URL; the repository is a temporary one.
 */

const run = (dir: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  return r.stdout.trim();
};

/** A repository: the analysed commit, then one that changes a.ts; origin/main points at it. */
function repo() {
  const dir = realTempDir("fd-sonar-left-");
  run(dir, "init", "-q", "-b", "main");
  run(dir, "config", "user.email", "t@t");
  run(dir, "config", "user.name", "t");
  run(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "a.ts"), "one\n");
  writeFileSync(join(dir, "b.ts"), "one\n");
  run(dir, "add", ".");
  run(dir, "commit", "-q", "-m", "first");
  const analysed = run(dir, "rev-parse", "HEAD");
  writeFileSync(join(dir, "a.ts"), "two\n");
  run(dir, "commit", "-q", "-am", "refactor(a): split it");
  const changed = run(dir, "rev-parse", "--short=9", "HEAD");
  run(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  const git = async (args: string[]) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    return { code: r.status ?? 1, stdout: r.stdout };
  };
  return { dir, analysed, changed, git };
}

const issue = (file: string, line: number, severity = "CRITICAL", rule = "typescript:S3776") => ({
  component: `jnerytech_flightdeck:${file}`,
  line,
  severity,
  rule,
  message: `Refactor ${file}.\nNow.`,
});

function fakeFetch(analysed: string, issues: object[], pageSize = 500) {
  const urls: string[] = [];
  const fetch = async (url: string): Promise<Fetched> => {
    urls.push(url);
    const ok = (body: unknown): Fetched => ({ ok: true, status: 200, json: async () => body });
    if (url.includes("/api/project_analyses/search")) {
      return ok({ analyses: [{ date: "2026-11-09T03:58:41+0000", revision: analysed }] });
    }
    if (url.includes("/api/issues/search")) {
      const page = Number(new URL(url).searchParams.get("p") ?? 1);
      const slice = issues.slice((page - 1) * pageSize, page * pageSize);
      return ok({
        total: issues.length,
        issues: slice,
        paging: { pageIndex: page, pageSize, total: issues.length },
      });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetch, urls };
}

describe("sonar-left: Sonar's open findings, stale ones marked (#1477)", () => {
  test("a finding whose file changed on main since the analysed commit is marked STALE? with that commit", async () => {
    const { analysed, changed, git } = repo();
    const { fetch } = fakeFetch(analysed, [
      issue("a.ts", 186),
      issue("b.ts", 3, "MAJOR", "typescript:S3358"),
    ]);
    const lines: string[] = [];
    expect(await sonarLeft([], { fetch, git, log: (l) => lines.push(l) })).toBe(0);
    expect(lines).toContain(
      `CRITICAL typescript:S3776 a.ts:186 Refactor a.ts. Now. STALE? (changed by ${changed} refactor(a): split it)`,
    );
    expect(lines).toContain("MAJOR typescript:S3358 b.ts:3 Refactor b.ts. Now.");
    expect(lines[0] ?? "").toContain(`analysed ${analysed.slice(0, 9)}`);
  });

  test("--severity and --path narrow the list, and every page of issues is read", async () => {
    const { analysed, git } = repo();
    const many = Array.from({ length: 3 }, (_, i) => issue(`src/x${i}.ts`, i + 1));
    const { fetch, urls } = fakeFetch(analysed, [...many, issue("lib/y.ts", 9, "MINOR")], 2);
    const lines: string[] = [];
    await sonarLeft(["--severity", "CRITICAL,MAJOR", "--path", "src/"], {
      fetch,
      git,
      log: (l) => lines.push(l),
    });
    expect(lines.filter((l) => l.startsWith("CRITICAL")).length).toBe(3);
    expect(lines.some((l) => l.includes("lib/y.ts"))).toBe(false);
    const asked = urls.filter((u) => u.includes("/api/issues/search"));
    expect([asked.length, asked[0]?.includes("severities=CRITICAL%2CMAJOR")]).toEqual([2, true]);
  });

  test("an analysed commit this clone does not have, or an API that fails, is one line and exit 1", async () => {
    const { git } = repo();
    const missing = fakeFetch("0123456789abcdef0123456789abcdef01234567", [issue("a.ts", 1)]);
    const lines: string[] = [];
    expect(await sonarLeft([], { fetch: missing.fetch, git, log: (l) => lines.push(l) })).toBe(1);
    expect(lines.at(-1)).toBe(
      "sonar-left: the analysed commit 012345678 is not in this clone: git fetch origin main",
    );
    const down = async (): Promise<Fetched> => ({ ok: false, status: 503, json: async () => ({}) });
    const out: string[] = [];
    expect(await sonarLeft([], { fetch: down, git, log: (l) => out.push(l) })).toBe(1);
    expect(out).toEqual(["sonar-left: SonarCloud answered 503"]);
    const offline = async (): Promise<Fetched> => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    const off: string[] = [];
    expect(await sonarLeft([], { fetch: offline, git, log: (l) => off.push(l) })).toBe(1);
    expect(off).toEqual([
      "sonar-left: SonarCloud could not be reached: Error: getaddrinfo ENOTFOUND",
    ]);
  });

  test("every field printed is one plain line: no escape, C1 control or bidi override from the API or git", async () => {
    const hostile = {
      component: "jnerytech_flightdeck:b\u202e.ts",
      line: 1,
      severity: "CRITICAL\u001b[31m",
      rule: "rule\u009b2J",
      message: "text\u2066x",
    };
    const { fetch } = fakeFetch("a".repeat(40), [hostile]);
    const lines: string[] = [];
    await sonarLeft([], {
      fetch,
      git: fakeGit({ log: "abc123456 fix\u001b[31m it\u202e" }),
      log: (l) => lines.push(l),
    });
    expect(lines[1]).toBe(
      "CRITICAL [31m rule 2J b .ts:1 text x STALE? (changed by abc123456 fix [31m it)",
    );
  });

  test("from the review: a missing origin/main or a failed git log fails closed; the header names origin/main", async () => {
    const { fetch } = fakeFetch("a".repeat(40), [issue("a.ts", 1)]);
    const lines: string[] = [];
    expect(
      await sonarLeft([], {
        fetch,
        git: fakeGit({ originMain: false }),
        log: (l) => lines.push(l),
      }),
    ).toBe(1);
    expect(lines).toEqual(["sonar-left: this clone has no origin/main: git fetch origin main"]);
    const failing: string[] = [];
    await sonarLeft([], { fetch, git: fakeGit({ logFails: true }), log: (l) => failing.push(l) });
    expect(failing[0] ?? "").toContain(
      "origin/main bbbbbbbbb (local: git fetch origin main to read the latest)",
    );
    expect(failing[1] ?? "").toEndWith("STALE? (git could not say what changed it)");
  });

  test("a commit that changed the file is named before any merge: the first look leaves merges out", async () => {
    const { fetch } = fakeFetch("a".repeat(40), [issue("a.ts", 1)]);
    const lines: string[] = [];
    await sonarLeft([], {
      fetch,
      git: fakeGit({ log: "aaa111222 fix(a): split it", merge: "ccc111222 Merge pull request #9" }),
      log: (l) => lines.push(l),
    });
    expect(lines[1] ?? "").toEndWith("STALE? (changed by aaa111222 fix(a): split it)");
  });

  test("from the review: a change that only a merge brought in is named by that merge", async () => {
    const { fetch } = fakeFetch("a".repeat(40), [issue("a.ts", 1)]);
    const lines: string[] = [];
    await sonarLeft([], {
      fetch,
      git: fakeGit({ log: "", merge: "ccc111222 Merge pull request #9" }),
      log: (l) => lines.push(l),
    });
    expect(lines[1] ?? "").toEndWith("STALE? (changed by ccc111222 Merge pull request #9)");
  });
});

/** A fake git by its arguments: the analysed commit is there, origin/main resolves, log answers. */
function fakeGit(o: { log?: string; merge?: string; originMain?: boolean; logFails?: boolean }) {
  return async (args: string[]) => {
    if (args[0] === "cat-file") return { code: 0, stdout: "" };
    if (args[0] === "rev-parse") {
      return o.originMain === false
        ? { code: 128, stdout: "" }
        : { code: 0, stdout: `${"b".repeat(40)}\n` };
    }
    if (args[0] === "log" && o.logFails) return { code: 128, stdout: "" };
    if (args[0] === "log" && args.includes("--no-merges")) return { code: 0, stdout: o.log ?? "" };
    if (args[0] === "log") return { code: 0, stdout: o.merge ?? o.log ?? "" };
    return { code: 1, stdout: "" };
  };
}
