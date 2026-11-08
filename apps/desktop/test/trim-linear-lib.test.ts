import { describe, expect, test } from "bun:test";
import { modelName } from "../src/lib/model-menu.ts";
import { projectCwd, projectLabel } from "../src/lib/usage-rows.ts";
import { defaultRule } from "../src/ui/AlwaysAllow.tsx";

/**
 * Issue #363 (Sonar S8786): a folder, a model id or a rule's file is cut at its end in one pass.
 * Each has its answers pinned and a worst-case input that must be read in a moment: with the regex
 * it had, the time grew with the square of the length.
 */
const FAST_MS = 1500;
const took = (run: () => unknown): number => {
  const started = performance.now();
  run();
  return performance.now() - started;
};

describe("trim-linear: the folder of a usage key", () => {
  test.each([
    ["host:h1:/a/b//", "/a/b", "b"],
    ["host:h1:C:\\w\\app\\", "C:\\w\\app", "app"],
    ["host:h1:/a/b", "/a/b", "b"],
    ["host:h1:/", "", ""],
    ["host:h1://", "", ""],
    ["github.com/a/b", null, "b"],
  ])("%j has the folder %j and the label %j", (key, cwd, label) => {
    expect(projectCwd(key)).toBe(cwd);
    expect(projectLabel(key)).toBe(label);
  });

  test("a long run of separators is read in a moment", () => {
    const key = `host:h1:${"/".repeat(60_000)}a`;
    expect(took(() => projectCwd(key))).toBeLessThan(FAST_MS);
    expect(took(() => projectLabel(key))).toBeLessThan(FAST_MS);
  });
});

describe("trim-linear: the model a person reads", () => {
  test.each([
    ["claude-opus-5-5[1m]", "Opus 5.5"],
    ["claude-opus-5-5[a[b]", "Opus 5.5"],
    ["claude-sonnet-5-5", "Sonnet 5.5"],
    ["opus-4-5[1m]", "opus-4-5[1m]"],
    ["sonnet[x", "sonnet[x"],
    ["[1m]", "[1m]"],
    ["a]b[c", "a]b[c"],
  ])("%j reads as %j", (id, expected) => {
    expect(modelName(id)).toBe(expected);
  });

  test("a long run of opening brackets is read in a moment", () => {
    expect(took(() => modelName("[".repeat(60_000)))).toBeLessThan(FAST_MS);
    expect(took(() => modelName(`claude-opus-5-5${"[a".repeat(30_000)}`))).toBeLessThan(FAST_MS);
  });
});

describe("trim-linear: the file of an always-allow rule", () => {
  test.each([
    ["/w/app/src/a.ts", "/w/app/", "Read(src/a.ts)"],
    ["C:\\w\\app\\a.ts", "C:\\w\\app\\\\", "Read(a.ts)"],
    ["/w/app", "/w/app///", "Read(.)"],
    ["/other/a.ts", "/w/app", "Read(//other/a.ts)"],
    ["rel.ts", "/w/app/", "Read(rel.ts)"],
    ["/a.ts", "", "Read(//a.ts)"],
    ["/a.ts", "///", "Read(//a.ts)"],
  ])("%j in %j gives %j", (file, cwd, expected) => {
    expect(defaultRule("Read", { file_path: file }, cwd)).toBe(expected);
  });

  test("a long run of slashes in the folder is read in a moment", () => {
    const cwd = `/w${"/".repeat(60_000)}a`;
    expect(took(() => defaultRule("Read", { file_path: "/w/a" }, cwd))).toBeLessThan(FAST_MS);
  });
});
