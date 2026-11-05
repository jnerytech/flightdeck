import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { registerDom } from "./dom.ts";

registerDom();
const { cleanup, render } = await import("@testing-library/react");
const { Page, Section } = await import("../src/components/layout/page.tsx");

const SRC = resolve(import.meta.dir, "../src");

/** The app's own .tsx files (the vendored components/ui are shadcn's, not ours). */
function ownSources(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return path.endsWith("components/ui") ? [] : ownSources(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/** Every data-testid in the app's sources, with whether a `testid:` comment above says why. */
function testids() {
  return ownSources().flatMap((file) => {
    const lines = readFileSync(file, "utf8").split("\n");
    return lines.flatMap((line, i) =>
      line.includes("data-testid")
        ? [
            {
              where: `${relative(SRC, file)}:${i + 1}`,
              why: lines.slice(Math.max(0, i - 3), i).some((above) => above.includes("testid:")),
            },
          ]
        : [],
    );
  });
}

// docs/TDD.md, "Test anchors": role and name first, data-slot for structure, data-testid last.
describe("test-anchors: how tests find what they check", () => {
  test("every data-testid in the app's own components has a testid: comment saying why", () => {
    expect(
      testids()
        .filter((hit) => !hit.why)
        .map((hit) => hit.where),
    ).toEqual([]);
  });

  test("the count of data-testid only goes down (apps/desktop/testid-baseline.json)", () => {
    const { count } = JSON.parse(
      readFileSync(resolve(import.meta.dir, "../testid-baseline.json"), "utf8"),
    ) as { count: number };
    expect(testids().length).toBeLessThanOrEqual(count);
  });

  test("a screen's Page and its Sections carry stable slots, so a layout finding names the region", () => {
    render(
      <Page title="Board">
        <Section title="Blocked by">
          <p>x</p>
        </Section>
      </Page>,
    );
    expect(document.querySelector("section[data-slot='page']")).not.toBeNull();
    expect(document.querySelector("section[data-slot='section']")).not.toBeNull();
    cleanup();
  });
});
