import { afterEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { readStyles } from "../../../../scripts/lib/styles/styles-source.ts";
import { registerDom } from "../dom.ts";

registerDom();
const { cleanup, render } = await import("@testing-library/react");
const { SessionView } = await import("../../src/features/sessions/session-view.tsx");
const { emptySession } = await import("../../src/features/sessions/session-state.ts");

afterEach(cleanup);

const css = readStyles(resolve(import.meta.dir, "../../src/styles.css"));
const utility = (name: string) => {
  const start = css.indexOf(`@utility ${name} {`);
  return start < 0 ? "" : css.slice(start, css.indexOf("\n}", start));
};
const actions = {
  send: async () => {},
  interrupt: async () => {},
  close: async () => {},
  resume: async () => {},
  respond: async () => {},
};

// Issue #177 (B11): the summary card spanned the column's whole width while the header and the
// conversation sit 16 px in from each side.
describe("session-header: the summary card lines up with the header and the conversation", () => {
  test("the summary card sits in a slot with the timeline's 16 px of side padding", () => {
    render(
      <SessionView
        title="s"
        session={{ ...emptySession(), status: "idle" }}
        actions={actions}
        recap={<div data-slot="recap">summary</div>}
      />,
    );
    const slot = document.querySelector("[data-slot='recap']")?.parentElement;
    expect(slot?.className.split(" ")).toContain("recap-slot");
    expect(/padding-inline:\s*1rem;/.test(utility("recap-slot"))).toBe(true);
  });
});
