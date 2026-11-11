import { afterEach, describe, expect, test } from "bun:test";
import { translator } from "../../src/i18n/index.ts";
import { registerDom } from "../dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { cleanup, render, screen } = await import("@testing-library/react");
const { ApprovalCard } = await import("../../src/components/approval/approval-card.tsx");

afterEach(cleanup);
// Issue #641, narrow-window guard ("sessao"): beside the Sessions list a session has about 320
// px at 640, and its view buttons, the folder of a request and the composer's buttons ran past
// it, even at 1024. Each of them now fits: the views scroll in one row, the folder breaks, and a
// narrow composer puts its box on a line of its own above the buttons. The views and the composer
// are measured by the e2e `sessao-vistas` and `layout-medido` journeys (#1850).
describe("sessao-estreita: a session fits a narrow pane", () => {
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
});
