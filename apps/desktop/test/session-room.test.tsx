import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";

registerDom();
const { cleanup, render, screen } = await import("@testing-library/react");
const { SessionView } = await import("../src/ui/SessionView.tsx");
const { emptySession } = await import("../src/lib/session-state.ts");

afterEach(cleanup);

const actions = {
  send: async () => {},
  interrupt: async () => {},
  close: async () => {},
  resume: async () => {},
  respond: async () => {},
};
const session = (waiting: boolean) => ({
  ...emptySession(),
  status: "idle" as const,
  pending: waiting ? ["r1"] : [],
  items: [
    { kind: "user" as const, seq: 1, text: "run the tests" },
    ...(waiting
      ? [
          {
            kind: "permission" as const,
            seq: 2,
            requestId: "r1",
            toolName: "Bash",
            input: { command: "npm test" },
          },
        ]
      : []),
  ],
});

// Issue #488: the tabs' own row took 36 px. While a request waits for the person, the session's
// header is its one line (title, controls, the rest under More actions), so the request card keeps
// its room (#173's check, with the status bar of #491 too).
describe("session-room: a request waiting gives the conversation the room", () => {
  test("with a request waiting the header is one line, its actions under More actions", () => {
    render(<SessionView title="s" session={session(true)} actions={actions} />);
    expect(screen.queryByRole("button", { name: "Mais ações" })).not.toBeNull();
  });

  test("with nothing waiting the header keeps its full form", () => {
    render(<SessionView title="s" session={session(false)} actions={actions} />);
    expect(screen.queryByRole("button", { name: "Mais ações" })).toBeNull();
  });
});
