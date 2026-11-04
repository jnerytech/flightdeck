import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";
import { RoiSignals } from "../src/roi/signals.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

function git(cwd: string, ...args: string[]) {
  const proc = Bun.spawnSync(
    [
      "git",
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
}

/** A repository whose commits are dated by hand. */
function repo(commits: Array<{ day: string; body: string }>): string {
  const dir = realTempDir("fd-roi-sig-");
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  commits.forEach((c, i) => {
    writeFileSync(join(dir, `f${i}`), String(i));
    git(dir, "add", ".");
    const date = `${c.day}T12:00:00Z`;
    const proc = Bun.spawnSync(
      [
        "git",
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-q",
        "-m",
        c.body,
      ],
      {
        cwd: dir,
        env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
  });
  return dir;
}

const AGENT = "work\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>";

describe("roi-sinais: agent commits", () => {
  test("counts the commits of the period that carry the Claude trailer, once each", async () => {
    const dir = repo([
      { day: "2026-09-30", body: AGENT },
      { day: "2026-10-02", body: AGENT },
      { day: "2026-10-03", body: "by a person" },
      { day: "2026-10-14", body: `${AGENT}\nCo-Authored-By: Claude Opus <x@y.invalid>` },
      { day: "2026-10-15", body: AGENT },
    ]);
    expect(await new RoiSignals().agentCommits(dir, "2026-10-01", "2026-10-14")).toBe(2);
  });

  test("a folder that is not a repository has none", async () => {
    expect(
      await new RoiSignals().agentCommits(realTempDir("fd-roi-none-"), "2026-10-01", "2026-10-14"),
    ).toBe(0);
  });
});

describe("roi-sinais: issues closed", () => {
  const rules = (n: number) => [
    {
      args: ["issue", "list"],
      stdout: JSON.stringify(Array.from({ length: n }, (_, i) => ({ number: i + 1 }))),
    },
  ];

  test("asks gh for the closed issues of the period and counts them", async () => {
    const gh = installFakeCli("gh", rules(3));
    cleanups.push(() => gh.restore());
    const result = await new RoiSignals().issuesClosed(
      realTempDir("fd-roi-gh-"),
      "2026-10-01",
      "2026-10-14",
    );
    expect(result).toEqual({ count: 3 });
    const call = gh.calls()[0] ?? [];
    expect(call).toContain("closed");
    expect(call.join(" ")).toContain("closed:2026-10-01..2026-10-14");
  });

  test("the answer is kept for an hour, per folder and period", async () => {
    const gh = installFakeCli("gh", rules(1));
    cleanups.push(() => gh.restore());
    let now = 1_000;
    const signals = new RoiSignals({ now: () => now });
    const dir = realTempDir("fd-roi-gh-");
    await signals.issuesClosed(dir, "2026-10-01", "2026-10-14");
    now += 3_599_000;
    await signals.issuesClosed(dir, "2026-10-01", "2026-10-14");
    expect(gh.calls()).toHaveLength(1);
    await signals.issuesClosed(dir, "2026-10-01", "2026-10-13");
    expect(gh.calls()).toHaveLength(2);
    now += 3_601_000;
    await signals.issuesClosed(dir, "2026-10-01", "2026-10-14");
    expect(gh.calls()).toHaveLength(3);
  });

  test("a gh that is signed out is a refusal with its reason, and is asked again next time", async () => {
    const gh = installFakeCli("gh", [
      {
        args: ["issue", "list"],
        code: 4,
        stderr: "To get started with GitHub CLI, please run:  gh auth login",
      },
    ]);
    cleanups.push(() => gh.restore());
    const signals = new RoiSignals();
    const dir = realTempDir("fd-roi-gh-");
    expect(await signals.issuesClosed(dir, "2026-10-01", "2026-10-14")).toEqual({
      error: "gh_logged_out",
    });
    await signals.issuesClosed(dir, "2026-10-01", "2026-10-14");
    expect(gh.calls()).toHaveLength(2);
  });

  test("any other failure of gh, and an answer that is not a list, are gh_failed", async () => {
    const gh = installFakeCli("gh", [{ args: ["issue", "list"], code: 1, stderr: "boom" }]);
    cleanups.push(() => gh.restore());
    const dir = realTempDir("fd-roi-gh-");
    expect(await new RoiSignals().issuesClosed(dir, "2026-10-01", "2026-10-14")).toEqual({
      error: "gh_failed",
    });
    gh.respond([{ args: ["issue", "list"], stdout: "not json" }]);
    expect(await new RoiSignals().issuesClosed(dir, "2026-10-01", "2026-10-14")).toEqual({
      error: "gh_failed",
    });
    gh.respond([{ args: ["issue", "list"], stdout: '{"a":1}' }]);
    expect(await new RoiSignals().issuesClosed(dir, "2026-10-01", "2026-10-14")).toEqual({
      error: "gh_failed",
    });
  });

  test("without gh on the PATH the reason is gh_missing", async () => {
    const before = process.env.PATH;
    process.env.PATH = "";
    cleanups.push(() => {
      process.env.PATH = before;
    });
    expect(
      await new RoiSignals().issuesClosed(realTempDir("fd-roi-gh-"), "2026-10-01", "2026-10-14"),
    ).toEqual({
      error: "gh_missing",
    });
  });
});

describe("roi-sinais: a folder that is gone", () => {
  test("neither signal throws: no commits, and gh_failed", async () => {
    const gh = installFakeCli("gh", [{ args: ["issue", "list"], stdout: "[]" }]);
    cleanups.push(() => gh.restore());
    const gone = join(realTempDir("fd-roi-gone-"), "nope");
    const signals = new RoiSignals();
    expect(await signals.agentCommits(gone, "2026-10-01", "2026-10-14")).toBe(0);
    expect(await signals.issuesClosed(gone, "2026-10-01", "2026-10-14")).toEqual({
      error: "gh_failed",
    });
  });
});
