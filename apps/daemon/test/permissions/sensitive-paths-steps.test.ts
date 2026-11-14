import { describe, expect, test } from "bun:test";
import { credential, isControl, pathParts } from "../../src/permissions/domain/sensitive-paths.ts";

/**
 * How a path is cut into steps, and what "a folder and a name in it" means (issue #1607: the
 * mutants of the credential and control lists that no other test killed).
 */

describe("pathParts: the steps of a path, compared without case, with either slash, with no empty or `.` step", () => {
  test("both slashes and any case give the same lower-case steps", () => {
    expect(pathParts("Src\\Sub/File.TS")).toEqual(["src", "sub", "file.ts"]);
  });

  test("a doubled slash, a trailing slash and a lone `.` step add no step", () => {
    expect(pathParts("a//b/./c/")).toEqual(["a", "b", "c"]);
    expect(pathParts("./a\\.\\b")).toEqual(["a", "b"]);
  });

  test("an empty path and a lone `.` have no step", () => {
    expect(pathParts("")).toEqual([]);
    expect(pathParts(".")).toEqual([]);
  });

  test("a `..` step and a name that starts with a dot stay: only `.` is dropped", () => {
    expect(pathParts("../.env/./x")).toEqual(["..", ".env", "x"]);
  });
});

describe("a folder and a name in it count only as that pair, in that order (secret pairs)", () => {
  test("the name inside its folder is a credential", () => {
    expect(credential("proj/.config/gh/hosts.yml")).toBe(true);
    expect(credential(".claude/settings.local.json")).toBe(true);
    expect(credential("home/.cargo/credentials.toml")).toBe(true);
  });

  test("the same name under another folder is not", () => {
    expect(credential("proj/src/gh/hosts.yml")).toBe(false);
    expect(credential("proj/notes/containers/readme.md")).toBe(false);
    expect(credential("proj/docs/credentials")).toBe(false);
  });

  test("the folder with another name in it, or the two the other way round, are not", () => {
    expect(credential("proj/.config/readme.md")).toBe(false);
    expect(credential("proj/.cargo/config.toml")).toBe(false);
    expect(credential("proj/gh/.config")).toBe(false);
  });

  test("the name must come right after the folder, not somewhere below it", () => {
    expect(credential("proj/.config/app/gh")).toBe(false);
  });
});

describe("a control folder and a name in it count only as that pair (control pairs)", () => {
  test("the workflows of the CI and the tasks of the editor are control", () => {
    expect(isControl("proj/.github/workflows/ci.yml")).toBe(true);
    expect(isControl("proj/.vscode/tasks.json")).toBe(true);
  });

  test("the same names under another folder are not", () => {
    expect(isControl("proj/src/workflows/ci.yml")).toBe(false);
    expect(isControl("proj/src/tasks.json")).toBe(false);
  });

  test("the folder with another name in it, or the two the other way round, are not", () => {
    expect(isControl("proj/.github/ISSUE_TEMPLATE.md")).toBe(false);
    expect(isControl("proj/.vscode/launch.json")).toBe(false);
    expect(isControl("proj/workflows/.github")).toBe(false);
  });
});
