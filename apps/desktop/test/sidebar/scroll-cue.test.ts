import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readStyles } from "../../../../scripts/lib/styles/styles-source.ts";

const css = readStyles(join(import.meta.dir, "../../src/styles.css"));
/** The body of one `@utility` rule, nested blocks included (up to the next top-level rule). */
const utility = (name: string) => css.split(`@utility ${name} {`)[1]?.split(/\n}\n/)[0] ?? "";

// #3955: with a project expanded, Board and the groups below sat under the fold with only a
// half-cut row as a cue. The sidebar keeps its one scroll (#567); a fade says more follows.
describe("sidebar-scroll-cue: the sidebar's one scroll shows where content continues (#3955)", () => {
  const body = utility("sidebar-body");

  test("the body still scrolls as one area", () => {
    expect(body.includes("overflow-y: auto")).toBe(true);
  });

  test("a fade at each edge shows only while content continues past it", () => {
    expect({
      fades: (body.match(/linear-gradient/g) ?? []).length >= 4,
      follows: /background-attachment:\s*local,\s*local,\s*scroll,\s*scroll/.test(body),
      matchesSidebar: body.includes("var(--sidebar)"),
    }).toEqual({ fades: true, follows: true, matchesSidebar: true });
  });
});
