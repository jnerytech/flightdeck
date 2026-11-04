import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { themeBlocksProblem } from "../lib/css-theme.ts";

const ROOT = resolve(import.meta.dir, "../..");

const GOOD = `
:root {
  --background: white;
}
.dark {
  --background: black;
}
@utility row {
  display: flex;
}
`;

describe("css-theme: a stylesheet has one :root block and the .dark block after it", () => {
  test("one :root followed by .dark is right", () => {
    expect(themeBlocksProblem(GOOD)).toBeNull();
  });

  test("a second :root, as a merge that kept both sides leaves, is named with its line (it would paint the light tokens over .dark)", () => {
    const merged = `${GOOD}\n:root {\n  --background: white;\n}\n`;
    expect(themeBlocksProblem(merged)).toBe(
      "2 top-level :root blocks (lines 2 and 12): a later one overrides .dark",
    );
  });

  test("no :root, or no .dark after the :root, is named", () => {
    expect(themeBlocksProblem(".dark {\n  --a: 1;\n}\n")).toBe("no top-level :root block");
    expect(themeBlocksProblem(":root {\n  --a: 1;\n}\n")).toBe(
      "no top-level .dark block after :root",
    );
    expect(themeBlocksProblem(".dark {\n  --a: 1;\n}\n:root {\n  --a: 1;\n}\n")).toBe(
      "no top-level .dark block after :root",
    );
  });

  test("a :root inside an at-rule, a comment or a selector list is not a top-level block", () => {
    const css = `/* :root { } */\n@media (min-width: 1px) {\n  :root {\n    --a: 1;\n  }\n}\n${GOOD}`;
    expect(themeBlocksProblem(css)).toBeNull();
    expect(themeBlocksProblem(`${GOOD}\nhtml:root {\n  --a: 1;\n}\n`)).toBeNull();
  });

  test("the app's stylesheet is right", () => {
    expect(
      themeBlocksProblem(readFileSync(resolve(ROOT, "apps/desktop/src/styles.css"), "utf8")),
    ).toBeNull();
  });
});
