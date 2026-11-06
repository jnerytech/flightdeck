import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** The app's own screens and components; the vendored shadcn ones in components/ui are not ours. */
const SRC = join(import.meta.dir, "..", "src");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return path.endsWith(join("components", "ui")) ? [] : tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

// Issue #588: a page's blocks sit 24 px apart from the body's gap. A filter row, a form or a
// panel that also carries `mb-4` adds 16 px to it, so the space under it reads as a break (40 px
// on Personas and Snippets). The space between blocks belongs to their container, not to a block.
describe("margens-blocos: blocks take their space from their container's gap", () => {
  test("no screen or component puts a 16 px bottom margin on a block", () => {
    const found = [join(SRC, "ui"), join(SRC, "components")].flatMap(tsxFiles).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) =>
          /\bmb-4\b/.test(line) ? [`${relative(SRC, file).replaceAll("\\", "/")}:${i + 1}`] : [],
        ),
    );
    expect(found).toEqual([]);
  });
});
