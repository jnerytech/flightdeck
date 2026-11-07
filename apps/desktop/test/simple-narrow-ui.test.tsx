import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NARROW_SHOTS } from "../../../scripts/lib/shots-narrow.ts";
import { BUILTIN_TEMPLATES } from "../../daemon/src/templates/builtin.ts";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { HomeView } = await import("../src/components/simple/home-view.tsx");

afterEach(cleanup);

const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");
/** The body of one `@utility` rule, nested blocks included (up to the next top-level rule). */
const utility = (name: string) => css.split(`@utility ${name} {`)[1]?.split(/\n}\n/)[0] ?? "";

// #784: simple mode scrolled sideways at 640 and 390 (scrollWidth 1148).
describe("simple-narrow: simple mode fits a narrow window", () => {
  test("its home is one of the prints demo:shots re-measures narrow, so CI sees a sideways scroll", () => {
    expect(NARROW_SHOTS.includes("simples-inicio")).toBe(true);
  });

  test("under 40rem the menu is a row above the screen, not a 11rem column beside it", () => {
    const narrow = (rule: string) =>
      /@media \(width < 40rem\) \{[^}]*\}/.exec(utility(rule))?.[0] ?? "";
    expect({
      frame: narrow("simple-frame").includes("flex-direction: column"),
      nav:
        narrow("simple-nav").includes("flex-direction: row") &&
        narrow("simple-nav").includes("width: auto"),
    }).toEqual({ frame: true, nav: true });
  });

  test("a template card's column is never wider than the screen", () => {
    expect(utility("template-cards").includes("minmax(min(14rem, 100%), 1fr)")).toBe(true);
  });

  test("a task's title wraps in its row, beside its state", () => {
    render(
      <HomeView
        templates={BUILTIN_TEMPLATES}
        tasks={[{ sessionId: "s1", title: "A very long title ".repeat(8), state: "waiting" }]}
        t={translator("en", "simple")}
        canPickFolder={false}
        onPickFolder={async () => null}
        onStart={async () => {}}
        onOpenTask={() => {}}
      />,
    );
    const open = screen.queryAllByRole("button", { name: /^Open A very long title/ })[0];
    const rule = utility("home-task-open");
    expect({
      wraps: rule.includes("white-space: normal") && rule.includes("min-width: 0"),
      own: open?.className.includes("home-task-open") ?? false,
      nowrap: open?.className.includes("whitespace-nowrap") ?? true,
    }).toEqual({ wraps: true, own: true, nowrap: false });
  });
});
