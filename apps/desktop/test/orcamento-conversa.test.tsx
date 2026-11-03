import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { registerDom } from "./dom.ts";

registerDom();

/** How many times a message's text was drawn: the work a token must not repeat. */
const drawn = { markdown: 0 };
function CountedMarkdown(props: { text: string }) {
  drawn.markdown++;
  return <p>{props.text}</p>;
}
const realMarkdown = { ...(await import("../src/ui/Markdown.tsx")) };
mock.module("../src/ui/Markdown.tsx", () => ({ Markdown: CountedMarkdown }));

// A module mock outlives its file in Bun: later files (the agent files preview) would draw this
// file's stand-in instead of the real renderer, and fail only in a full run. The check draws the
// real one and waits for its lazy body: until that chunk is loaded the renderer is a plain-text
// fallback, which is not a sign of the mock leaking.
afterAll(async () => {
  mock.module("../src/ui/Markdown.tsx", () => realMarkdown);
  const { Markdown } = await import("../src/ui/Markdown.tsx");
  const { findByRole, render: draw } = await import("@testing-library/react");
  const view = draw(<Markdown text={"# Título"} />);
  expect((await findByRole(view.container, "heading", { level: 1 })).textContent).toBe("Título");
  view.unmount();
});

const { act, cleanup, render } = await import("@testing-library/react");
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

const history = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    kind: "assistant" as const,
    seq: i + 1,
    blocks: [{ type: "text" as const, text: `resposta ${i + 1}` }],
  }));

describe("orcamento-conversa: a token does not redraw the conversation", () => {
  test("while an answer streams, the messages already there are not drawn again", async () => {
    const base = { ...emptySession(), status: "running" as const, items: history(60) };
    const view = render(<SessionView title="s" session={base} actions={actions} />);
    const first = drawn.markdown;
    expect(first).toBe(60);
    for (let i = 1; i <= 20; i++) {
      await act(async () => {
        view.rerender(
          <SessionView
            title="s"
            session={{ ...base, streaming: "palavra ".repeat(i), lastSeq: 100 + i }}
            actions={actions}
          />,
        );
      });
    }
    expect(drawn.markdown - first).toBe(0);
  });

  test("a new message is drawn once, and the older ones still not", async () => {
    const base = { ...emptySession(), status: "running" as const, items: history(10) };
    const view = render(<SessionView title="s" session={base} actions={actions} />);
    const first = drawn.markdown;
    await act(async () => {
      view.rerender(
        <SessionView
          title="s"
          session={{ ...base, items: [...base.items, ...history(11).slice(10)] }}
          actions={actions}
        />,
      );
    });
    expect(drawn.markdown - first).toBe(1);
  });
});
