import { describe, expect, test } from "bun:test";
import { breadcrumbSteps, holdsFolder, trimTrailingSeparators } from "../src/lib/paths.ts";

describe("paths", () => {
  test("holdsFolder: the root itself and what is below it, with either separator, and nothing else", () => {
    expect([
      holdsFolder("/work/app", "/work/app"),
      holdsFolder("/work/app/", "/work/app"),
      holdsFolder("/work/app", "/work/app/src"),
      holdsFolder("C:\\work\\app", "C:\\work\\app\\src"),
      holdsFolder("/work/app", "/work/app-two"),
      holdsFolder("/work/app", "/work"),
      holdsFolder("/work/app", "/WORK/app"),
    ]).toEqual([true, true, true, true, false, false, false]);
  });

  test("trimTrailingSeparators drops trailing slashes and backslashes", () => {
    expect(trimTrailingSeparators("/home/me/project/")).toBe("/home/me/project");
    expect(trimTrailingSeparators("C:\\work\\project\\")).toBe("C:\\work\\project");
    expect(trimTrailingSeparators("/home/me/project//\\/")).toBe("/home/me/project");
    expect(trimTrailingSeparators("///")).toBe("");
  });

  test("trimTrailingSeparators keeps separators that are not trailing", () => {
    expect(trimTrailingSeparators("/home/me")).toBe("/home/me");
    expect(trimTrailingSeparators("")).toBe("");
    expect(trimTrailingSeparators(`${"/".repeat(50_000)}x`)).toBe(`${"/".repeat(50_000)}x`);
  });

  test("breadcrumbSteps: a root, then each folder below it, with the path each opens (POSIX)", () => {
    expect(breadcrumbSteps("/home/me/code/app/src", "/home/me/code")).toEqual([
      { name: "code", path: "/home/me/code" },
      { name: "app", path: "/home/me/code/app" },
      { name: "src", path: "/home/me/code/app/src" },
    ]);
    expect(breadcrumbSteps("/home/me/code", "/home/me/code/")).toEqual([
      { name: "code", path: "/home/me/code/" },
    ]);
  });

  test("breadcrumbSteps: Windows paths keep their backslashes, and a drive root is named by the drive", () => {
    expect(breadcrumbSteps("C:\\Users\\me\\code\\app", "C:\\Users\\me\\code")).toEqual([
      { name: "code", path: "C:\\Users\\me\\code" },
      { name: "app", path: "C:\\Users\\me\\code\\app" },
    ]);
    expect(breadcrumbSteps("C:\\work\\app", "C:\\")).toEqual([
      { name: "C:", path: "C:\\" },
      { name: "work", path: "C:\\work" },
      { name: "app", path: "C:\\work\\app" },
    ]);
  });

  test("breadcrumbSteps: the path may be written in other letters than the root (Windows)", () => {
    expect(breadcrumbSteps("c:\\USERS\\me\\app", "C:\\Users\\me")).toEqual([
      { name: "me", path: "C:\\Users\\me" },
      { name: "app", path: "C:\\Users\\me\\app" },
    ]);
  });
});
