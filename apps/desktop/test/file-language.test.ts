import { describe, expect, test } from "bun:test";
import { languageFor, loadLanguage } from "../src/lib/file-language.ts";

describe("file-language: which language colors a file in the viewer (#506)", () => {
  test("by extension, without regard to case, and by a few whole names", () => {
    const cases: Array<[string, string | null]> = [
      ["src/app.ts", "typescript"],
      ["src/App.TSX", "typescript"],
      ["index.mjs", "javascript"],
      ["package.json", "json"],
      ["tool.py", "python"],
      ["main.rs", "rust"],
      ["run.sh", "shell"],
      ["Cargo.toml", "toml"],
      [".github/workflows/ci.yml", "yaml"],
      ["styles.css", "css"],
      ["server.go", "go"],
      ["page.html", "html"],
      ["Dockerfile", "dockerfile"],
      ["fix.patch", "diff"],
      ["README.md", null],
      ["notes", null],
      [".env", null],
    ];
    expect(cases.map(([name]) => [name, languageFor(name)])).toEqual(cases);
  });

  test("each language loads its parser on demand, named after it", async () => {
    const names = await Promise.all(
      ["typescript", "json", "python", "rust", "shell", "toml", "yaml", "css", "go", "html"].map(
        async (key) => [key, (await loadLanguage(key))?.name ?? null],
      ),
    );
    expect(names.every(([, name]) => typeof name === "string" && name.length > 0)).toBe(true);
    // The Dockerfile mode has no name of its own; it is a parser all the same.
    expect(typeof (await loadLanguage("dockerfile"))?.token).toBe("function");
    expect(await loadLanguage("cobol-from-the-future")).toBeNull();
  });
});
