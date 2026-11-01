import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SessionView } = await import("../src/ui/SessionView.tsx");
const { emptySession } = await import("../src/lib/session-state.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");

afterEach(cleanup);

const actions = {
  send: async () => {},
  interrupt: async () => {},
  close: async () => {},
  resume: async () => {},
  respond: async () => {},
};

describe("entrega-aviso: a hole in the history says so", () => {
  const session = {
    ...emptySession(),
    status: "idle" as const,
    items: [{ kind: "gap" as const, seq: 5 }],
  };

  test("in Portuguese", () => {
    render(<SessionView title="s" session={session} actions={actions} />);
    expect(
      screen.queryByText("parte do histórico não está mais disponível no host"),
    ).not.toBeNull();
  });

  test("in English", () => {
    render(
      <TContext.Provider value={translator("en")}>
        <SessionView title="s" session={session} actions={actions} />
      </TContext.Provider>,
    );
    expect(
      screen.queryByText("part of the history is no longer available on the host"),
    ).not.toBeNull();
  });
});
