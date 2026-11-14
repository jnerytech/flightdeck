import { describe, expect, test } from "bun:test";
import { normalizeCwdFor } from "../../src/history/domain/folder.ts";
import { normalizeCwd } from "../../src/history/folder.ts";

// The folder a transcript belongs to is compared in one form, so `C:\proj\` and `c:/proj` are one.
describe("history: the comparable form of a folder", () => {
  const same = (path: string) => normalizeCwd(path).toLowerCase();

  test("slashes of either kind at the end are dropped, and a backslash is a slash", () => {
    expect(same("/home/me/proj///")).toBe("/home/me/proj");
    expect(same("C:\\Work\\proj\\\\")).toBe("c:/work/proj");
    expect(same("/home/me/proj/\\/")).toBe("/home/me/proj");
    expect(same("/home/me/proj")).toBe("/home/me/proj");
  });

  test("a path of nothing but slashes is empty", () => {
    expect(normalizeCwd("///")).toBe("");
    expect(normalizeCwd("")).toBe("");
  });

  test("case is folded on the platforms whose file systems fold it, and kept on the others", () => {
    expect(normalizeCwdFor("C:\\Work\\Proj\\", "win32")).toBe("c:/work/proj");
    expect(normalizeCwdFor("/Users/Me/Proj/", "darwin")).toBe("/users/me/proj");
    expect(normalizeCwdFor("/home/Me/Proj/", "linux")).toBe("/home/Me/Proj");
  });
});
