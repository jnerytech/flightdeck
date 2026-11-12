import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DRIVER_COMMAND,
  DRIVER_NAME,
  type GitRun,
  mergeBaselines,
  registerMergeDriver,
} from "../../lib/baseline-merge.ts";
import { GIT_ENV_VARS } from "../git-env.ts";
import { realTempDir } from "../temp-dir.ts";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

describe("baseline-merge: a path-keyed count map (src-size, json-parse)", () => {
  const base = { "apps/a.ts": 3, "apps/b.ts": 2, "apps/c.ts": 5 };

  test("renames of neighbouring keys on both sides merge, sorted, in the writers' format", () => {
    const ours = { "apps/a2.ts": 3, "apps/b.ts": 2, "apps/c.ts": 5 };
    const theirs = { "apps/a.ts": 3, "apps/b2.ts": 2, "apps/c.ts": 5 };
    expect(mergeBaselines(json(base), json(ours), json(theirs))).toEqual({
      ok: true,
      text: json({ "apps/a2.ts": 3, "apps/b2.ts": 2, "apps/c.ts": 5 }),
    });
  });

  test("both sides lower the same key: the lower count wins", () => {
    const ours = { ...base, "apps/c.ts": 4 };
    const theirs = { ...base, "apps/c.ts": 1 };
    expect(mergeBaselines(json(base), json(ours), json(theirs))).toEqual({
      ok: true,
      text: json({ ...base, "apps/c.ts": 1 }),
    });
  });

  test("both sides add the same key: the same count merges, two counts conflict", () => {
    const ours = { ...base, "apps/d.ts": 4 };
    expect(mergeBaselines(json(base), json(ours), json(ours))).toEqual({
      ok: true,
      text: json(ours),
    });
    // The merged file holds both sides' additions: its count may be neither, so a person decides.
    const theirs = { ...base, "apps/d.ts": 2 };
    expect(mergeBaselines(json(base), json(ours), json(theirs)).ok).toBe(false);
  });

  test("a deletion on one side wins over a lower count on the other", () => {
    const { "apps/b.ts": _gone, ...ours } = base;
    const theirs = { ...base, "apps/b.ts": 1 };
    expect(mergeBaselines(json(base), json(ours), json(theirs))).toEqual({
      ok: true,
      text: json(ours),
    });
  });

  test("a raised count on either side is a conflict, even with no other change", () => {
    const raised = { ...base, "apps/a.ts": 4 };
    expect(mergeBaselines(json(base), json(raised), json(base)).ok).toBe(false);
    expect(mergeBaselines(json(base), json(base), json(raised)).ok).toBe(false);
    const { "apps/a.ts": _gone, ...deleted } = base;
    expect(mergeBaselines(json(base), json(deleted), json(raised)).ok).toBe(false);
  });
});

describe("baseline-merge: a sorted path list (fast-coverage)", () => {
  test("additions from both sides stay, a removal on either side goes", () => {
    const base = ["apps/a.ts", "apps/b.ts", "apps/c.ts"];
    const ours = ["apps/a2.ts", "apps/b.ts", "apps/c.ts", "apps/e.ts"];
    const theirs = ["apps/a.ts", "apps/b2.ts", "apps/c.ts", "apps/d.ts"];
    expect(mergeBaselines(json(base), json(ours), json(theirs))).toEqual({
      ok: true,
      text: json(["apps/a2.ts", "apps/b2.ts", "apps/c.ts", "apps/d.ts", "apps/e.ts"]),
    });
  });
});

describe("baseline-merge: what it does not merge", () => {
  test("an empty base (both sides added the file), bad JSON or two shapes is a conflict", () => {
    const map = json({ "apps/a.ts": 1 });
    expect(mergeBaselines("", map, map).ok).toBe(false);
    expect(mergeBaselines(map, "{", map).ok).toBe(false);
    expect(mergeBaselines(map, json(["apps/a.ts"]), map).ok).toBe(false);
    expect(mergeBaselines(map, json({ "apps/a.ts": "1" }), map).ok).toBe(false);
  });
});

describe("baseline-merge: registration", () => {
  const fakeGit = (current: string | null) => {
    const calls: string[][] = [];
    const git: GitRun = (args) => {
      calls.push(args);
      if (args[0] === "config" && args[1] === "--get") {
        return current === null ? { status: 1, stdout: "" } : { status: 0, stdout: `${current}\n` };
      }
      return { status: 0, stdout: "" };
    };
    return { git, calls };
  };

  test("a repository without the driver gets its name and command", () => {
    const { git, calls } = fakeGit(null);
    expect(registerMergeDriver(git)).toBe(true);
    expect(calls.slice(1)).toEqual([
      ["config", `merge.${DRIVER_NAME}.name`, "path-keyed ratchet baselines (#2270)"],
      ["config", `merge.${DRIVER_NAME}.driver`, DRIVER_COMMAND],
    ]);
  });

  test("a repository with the same command is left alone", () => {
    const { git, calls } = fakeGit(DRIVER_COMMAND);
    expect(registerMergeDriver(git)).toBe(false);
    expect(calls).toEqual([["config", "--get", `merge.${DRIVER_NAME}.driver`]]);
  });

  test(".gitattributes names the three baselines with the driver", () => {
    const attributes = readFileSync(join(import.meta.dir, "../../../.gitattributes"), "utf8");
    for (const file of [
      "src-size-baseline.json",
      "json-parse-baseline.json",
      "fast-coverage-baseline.json",
    ]) {
      expect(attributes).toContain(`${file} merge=${DRIVER_NAME}`);
    }
  });
});

describe("baseline-merge: through git", () => {
  const scripts = join(import.meta.dir, "../..");
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
  };
  for (const name of GIT_ENV_VARS) delete env[name];

  const repo = () => {
    const root = realTempDir("baseline-merge-");
    const git = (...args: string[]) =>
      Bun.spawnSync(
        [
          "git",
          "-c",
          "user.email=test@example.invalid",
          "-c",
          "user.name=test",
          "-c",
          "commit.gpgsign=false",
          "-c",
          "core.hooksPath=/dev/null",
          ...args,
        ],
        { cwd: root, env, stdout: "pipe", stderr: "pipe" },
      );
    git("init", "-q", "-b", "main");
    mkdirSync(join(root, "scripts/lib"), { recursive: true });
    copyFileSync(join(scripts, "merge-baseline.ts"), join(root, "scripts/merge-baseline.ts"));
    copyFileSync(
      join(scripts, "lib/baseline-merge.ts"),
      join(root, "scripts/lib/baseline-merge.ts"),
    );
    writeFileSync(join(root, ".gitattributes"), `src-size-baseline.json merge=${DRIVER_NAME}\n`);
    git("config", `merge.${DRIVER_NAME}.driver`, DRIVER_COMMAND);
    // Sorted, as `src-size.ts --write` writes it: a rename changes its line in place.
    const write = (value: Record<string, number | undefined>) => {
      const sorted = Object.entries(value)
        .filter(([, count]) => count !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1));
      writeFileSync(join(root, "src-size-baseline.json"), json(Object.fromEntries(sorted)));
    };
    const commit = (message: string) => {
      git("add", ".");
      git("commit", "-q", "-m", message);
    };
    return { root, git, write, commit };
  };
  const base = { "apps/a.ts": 900, "apps/b.ts": 850, "apps/c.ts": 820 };

  test("two branches that renamed neighbouring keys merge with no conflict", () => {
    const { root, git, write, commit } = repo();
    try {
      write(base);
      commit("base");
      git("checkout", "-q", "-b", "other");
      write({ ...base, "apps/b.ts": undefined, "apps/b2.ts": 850 });
      commit("rename b");
      git("checkout", "-q", "main");
      write({ ...base, "apps/a.ts": undefined, "apps/a2.ts": 900 });
      commit("rename a");
      const merge = git("merge", "-q", "--no-edit", "other");
      expect(merge.exitCode).toBe(0);
      expect(readFileSync(join(root, "src-size-baseline.json"), "utf8")).toBe(
        json({ "apps/a2.ts": 900, "apps/b2.ts": 850, "apps/c.ts": 820 }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a branch that raised a count still conflicts, with markers", () => {
    const { root, git, write, commit } = repo();
    try {
      write(base);
      commit("base");
      git("checkout", "-q", "-b", "other");
      write({ ...base, "apps/c.ts": 830 });
      commit("raise c");
      git("checkout", "-q", "main");
      // Two lines apart: git's line merge alone would take the raise with no marker.
      write({ ...base, "apps/a.ts": undefined, "apps/a2.ts": 900 });
      commit("rename a");
      const merge = git("merge", "-q", "--no-edit", "other");
      expect(merge.exitCode).not.toBe(0);
      expect(readFileSync(join(root, "src-size-baseline.json"), "utf8")).toContain("<<<<<<<");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
