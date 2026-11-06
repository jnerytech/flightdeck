import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { translator } from "../src/i18n/index.ts";
import { registerDom } from "./dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { cleanup, render, screen } = await import("@testing-library/react");
const { SessionTabs } = await import("../src/ui/SessionTabs.tsx");
const { ApprovalCard } = await import("../src/components/approval/approval-card.tsx");

afterEach(cleanup);
const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");

/** The body of one `@utility` block, nested rules included. */
function utility(name: string): string {
  const start = css.indexOf(`@utility ${name} {`);
  if (start < 0) return "";
  let depth = 0;
  for (let at = css.indexOf("{", start); at < css.length; at++) {
    if (css[at] === "{") depth++;
    if (css[at] === "}" && --depth === 0) return css.slice(start, at + 1);
  }
  return "";
}

// Issue #641, narrow-window guard ("sessao"): beside the Sessions list a session has about 320
// px at 640, and its view buttons, the folder of a request and the composer's buttons ran past
// it, even at 1024. Each of them now fits: the views wrap, the folder breaks, and a narrow
// composer puts its box on a line of its own above the buttons.
describe("sessao-estreita: a session fits a narrow pane", () => {
  test("the row of views wraps when it does not fit", () => {
    render(
      <SessionTabs store={{} as never} hostId="h" claudeSessionId="c-1" enabled>
        <p>conversation</p>
      </SessionTabs>,
    );
    const row = screen.queryByRole("button", { name: "Conversa" })?.parentElement;
    expect({
      slot: row?.getAttribute("data-slot") ?? null,
      wraps: row?.className.split(" ").includes("flex-wrap") ?? false,
    }).toEqual({ slot: "session-views", wraps: true });
  });

  test("a request's folder breaks inside the card instead of running past it", () => {
    render(
      <ApprovalCard
        request={{
          requestId: "r1",
          toolName: "Bash",
          input: { command: "npm test" },
          cwd: "/tmp/fd-demo-3RBdUd/alfa/projects/flightdeck-web-with-a-long-name",
          createdAt: "2026-11-06T10:00:00.000Z",
        }}
        t={translator("pt-BR")}
        nowMs={Date.parse("2026-11-06T10:09:00.000Z")}
        onCopyPath={() => {}}
        onRespond={() => {}}
      />,
    );
    const folder = document.querySelector("[data-folder]")?.className.split(" ") ?? [];
    expect(["min-w-0", "break-all"].filter((c) => !folder.includes(c))).toEqual([]);
  });

  test("in a narrow dock the composer's box takes its own line, above the buttons", () => {
    const card = utility("composer-card");
    expect({
      container: utility("composer-dock").includes("container-type: inline-size"),
      wraps: /@container \(width < 28rem\) \{[^}]*flex-wrap: wrap/.test(card),
      boxFirst:
        /@container \(width < 28rem\) \{[\s\S]*\.composer-box \{[^}]*order: -1;[^}]*flex-basis: 100%/.test(
          card,
        ),
    }).toEqual({ container: true, wraps: true, boxFirst: true });
  });
});
