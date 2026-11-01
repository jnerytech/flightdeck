import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { packageOf, reachedPackages, slashed, staticImports } from "../lib/bundle-reach.ts";

describe("bundle-lazy: what an entry point loads at start-up", () => {
  test("staticImports lists value imports and re-exports, and skips types, dynamic imports and comments", () => {
    const source = `
      import { a } from "./a.ts";
      import b, { type T, c } from "@/lib/b";
      import type { Only } from "./types.ts";
      import { type X, type Y } from "./x-types.ts";
      import * as ns from "react";
      import "./styles.css";
      export { d } from "./d.ts";
      export * from "./e.ts";
      export type { Z } from "./z.ts";
      export const notAnImport = "./nope.ts";
      const lazy = () => import("./lazy.ts");
      // import { gone } from "./comment.ts";
      import {
        multi,
        line,
      } from "@codemirror/view";
    `;
    expect(staticImports(source)).toEqual([
      "./a.ts",
      "@/lib/b",
      "react",
      "./styles.css",
      "./d.ts",
      "./e.ts",
      "@codemirror/view",
    ]);
  });

  test("a package is named by its first segment, or two for a scope; paths are not packages", () => {
    expect(packageOf("react")).toBe("react");
    expect(packageOf("react-dom/client")).toBe("react-dom");
    expect(packageOf("@codemirror/view")).toBe("@codemirror/view");
    expect(packageOf("@xterm/addon-fit/lib/x")).toBe("@xterm/addon-fit");
    expect(packageOf("./a.ts")).toBeNull();
    expect(packageOf("@/lib/b")).toBeNull();
    expect(packageOf("node:fs")).toBeNull();
  });

  test("slashed gives a chain the same names on every platform", () => {
    expect(slashed("ui\\sub\\App.tsx", "\\")).toBe("ui/sub/App.tsx");
    expect(slashed("ui/App.tsx", "/")).toBe("ui/App.tsx");
  });

  test("it follows relative and @/ imports and reports the chain to a watched package, not past a dynamic import", () => {
    const root = mkdtempSync(join(tmpdir(), "fd-reach-"));
    const write = (file: string, text: string) => {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    };
    write("main.tsx", `import { App } from "./ui/App.tsx";\nimport { zod } from "zod";`);
    write(
      "ui/App.tsx",
      `import { lib } from "@/lib/lib.ts";\nimport { Panel } from "../panel/index.tsx";`,
    );
    write("lib/lib.ts", `import { EditorView } from "@codemirror/view";`);
    write("panel/index.tsx", `export const Panel = () => import("../lazy/heavy.ts");`);
    write("lazy/heavy.ts", `import { Encrypter } from "age-encryption";`);
    const reached = reachedPackages(["main.tsx"], root, ["@codemirror/", "age-encryption", "zod"]);
    expect(reached).toEqual([
      { package: "zod", via: ["main.tsx"] },
      { package: "@codemirror/view", via: ["main.tsx", "ui/App.tsx", "lib/lib.ts"] },
    ]);
  });
});

describe("bundle-lazy: the heavy packages stay out of the entry chunk", () => {
  test("neither entry point loads CodeMirror, age, xterm or the Markdown renderer at start-up: they sit behind import() / React.lazy", () => {
    const src = join(import.meta.dir, "../../apps/desktop/src");
    const reached = reachedPackages(["main.tsx", "main.web.tsx"], src, [
      "@codemirror/",
      "age-encryption",
      "@xterm/",
      "react-markdown",
      "remark-gfm",
    ]);
    expect(reached).toEqual([]);
  });
});
