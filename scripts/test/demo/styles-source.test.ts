import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readStyles } from "../../lib/styles/styles-source.ts";
import { realTempDir } from "../temp-dir.ts";

const dir = realTempDir("styles-source-");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function write(name: string, text: string): string {
  const file = join(dir, name);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
  return file;
}

describe("styles-source: the stylesheet is the entry with its local imports put in place", () => {
  test("a stylesheet with no local import reads as it is", () => {
    const entry = write("plain/styles.css", '@import "tailwindcss";\n.a { color: red; }\n');
    expect(readStyles(entry)).toBe('@import "tailwindcss";\n.a { color: red; }\n');
  });

  test("a local import is replaced by its file, in its place, so the rule order stays", () => {
    write("order/styles/board.css", ".board { color: blue; }\n");
    const entry = write(
      "order/styles.css",
      '.first { top: 0; }\n@import "./styles/board.css";\n.last { top: 1; }\n',
    );
    expect(readStyles(entry)).toBe(
      ".first { top: 0; }\n.board { color: blue; }\n\n.last { top: 1; }\n",
    );
  });

  test("a package import stays a line, and an import inside an imported file is followed from that file", () => {
    write("nested/styles/deep/a.css", ".a { margin: 0; }\n");
    write("nested/styles/b.css", '@import "./deep/a.css";\n.b { margin: 1px; }\n');
    const entry = write(
      "nested/styles.css",
      '@import "tw-animate-css";\n@import "./styles/b.css";\n',
    );
    expect(readStyles(entry)).toBe(
      '@import "tw-animate-css";\n.a { margin: 0; }\n\n.b { margin: 1px; }\n\n',
    );
  });

  test("a URL names the entry like a path does", () => {
    const entry = write("url/styles.css", ".u { top: 2px; }\n");
    expect(readStyles(pathToFileURL(entry))).toBe(".u { top: 2px; }\n");
  });

  test("two files that import each other are an error that says so, not a stack overflow", () => {
    write("cycle/styles/a.css", '@import "./b.css";\n');
    write("cycle/styles/b.css", '@import "./a.css";\n');
    const entry = write("cycle/styles.css", '@import "./styles/a.css";\n');
    expect(() => readStyles(entry)).toThrow("import cycle");
  });

  test("an import of a file that is not there is an error that names it", () => {
    const entry = write("missing/styles.css", '@import "./styles/gone.css";\n');
    expect(() => readStyles(entry)).toThrow("gone.css");
  });
});
