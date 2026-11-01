import { afterEach, describe, expect, mock, test } from "bun:test";
import { registerDom } from "./dom.ts";

registerDom();

/** How many times a message's text was drawn: the work a token must not repeat. */
const drawn = { markdown: 0 };
function CountedMarkdown(props: { text: string }) {
  drawn.markdown++;
  return <p>{props.text}</p>;
}
mock.module("../src/ui/Markdown.tsx", () => ({ Markdown: CountedMarkdown }));

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
