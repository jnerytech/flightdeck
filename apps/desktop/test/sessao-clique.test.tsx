import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SessionView } = await import("../src/ui/SessionView.tsx");
const { emptySession } = await import("../src/lib/session-state.ts");

afterEach(cleanup);

/** A promise the test settles by hand. */
function gate() {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const press = async (name: string | RegExp) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
const busy = (name: string | RegExp) =>
  screen.queryByRole("button", { name })?.getAttribute("aria-busy");

function actions(over: Record<string, () => Promise<void>> = {}) {
  const calls: string[] = [];
  const base = {
    send: async (text: string) => void calls.push(`send:${text}`),
    interrupt: async () => void calls.push("interrupt"),
    close: async () => void calls.push("close"),
    resume: async () => void calls.push("resume"),
    respond: async () => {},
  };
  return { calls, actions: { ...base, ...over } as typeof base };
}

describe("sessao-clique: the session screen answers a click", () => {
  test("Interromper is busy while the interrupt works, and a second click does nothing", async () => {
    const work = gate();
    const a = actions({ interrupt: () => work.promise });
    let interrupts = 0;
    const counted = {
      ...a.actions,
      interrupt: () => {
        interrupts++;
        return work.promise;
      },
    };
    render(
      <SessionView
        title="s"
        session={{ ...emptySession(), status: "running" }}
        actions={counted}
      />,
    );
    await press("Interromper");
    expect(busy(/Interromper/)).toBe("true");
    await press(/Interromper/);
    expect(interrupts).toBe(1);
    work.open();
    await act(() => Bun.sleep(10));
    expect(busy(/Interromper/)).toBeNull();
  });

  test("Retomar is busy while the session resumes", async () => {
    const work = gate();
    const a = actions({ resume: () => work.promise });
    render(
      <SessionView
        title="s"
        session={{ ...emptySession(), status: "ended" }}
        actions={a.actions}
      />,
    );
    await press("Retomar");
    expect(busy(/Retomar/)).toBe("true");
    work.open();
    await act(() => Bun.sleep(10));
    expect(busy(/Retomar/)).toBeNull();
  });

  test("Encerrar is busy from the confirmation until the session is closed", async () => {
    const work = gate();
    const a = actions({ close: () => work.promise });
    render(
      <SessionView title="s" session={{ ...emptySession(), status: "idle" }} actions={a.actions} />,
    );
    await press("Encerrar");
    await press("Encerrar sessão");
    await act(() => Bun.sleep(10));
    expect(busy(/Encerrar/)).toBe("true");
    work.open();
    await act(() => Bun.sleep(10));
    expect(busy(/Encerrar/)).toBeNull();
  });

  test("Enviar with an empty box is not dead: it puts the cursor in the box", async () => {
    const a = actions();
    render(
      <SessionView title="s" session={{ ...emptySession(), status: "idle" }} actions={a.actions} />,
    );
    await press("Enviar");
    expect(document.activeElement).toBe(screen.queryByLabelText("Mensagem"));
    expect(a.calls).toEqual([]);
  });

  test("Enviar sends the text and empties the box", async () => {
    const a = actions();
    render(
      <SessionView title="s" session={{ ...emptySession(), status: "idle" }} actions={a.actions} />,
    );
    await act(async () => {
      fireEvent.change(screen.queryByLabelText("Mensagem") as HTMLElement, {
        target: { value: "  oi  " },
      });
    });
    await press("Enviar");
    expect(a.calls).toEqual(["send:oi"]);
    expect((screen.queryByLabelText("Mensagem") as HTMLTextAreaElement).value).toBe("");
  });

  test("the header keeps the buttons in one row aligned at the bottom, and the persona controls in a row of their own", async () => {
    const a = actions();
    render(
      <SessionView
        title="s"
        session={{ ...emptySession(), status: "idle" }}
        actions={a.actions}
        terminal={<button type="button">Terminal</button>}
        persona={<div data-testid="persona">Aplicar persona</div>}
      />,
    );
    const controls = document.querySelector("[data-slot='session-controls']");
    const extra = document.querySelector("[data-slot='session-extra']");
    expect(controls?.className ?? "").toContain("items-end");
    expect(controls?.textContent ?? "").toContain("Terminal");
    expect(controls?.textContent ?? "").toContain("Interromper");
    expect(controls?.querySelector("[data-testid='persona']")).toBeNull();
    expect(extra?.querySelector("[data-testid='persona']")).not.toBeNull();
  });
});
