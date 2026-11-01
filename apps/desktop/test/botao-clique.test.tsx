import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ActionButton: Button } = await import("../src/components/feedback/action-button.tsx");

afterEach(cleanup);

const tick = () => act(() => Bun.sleep(10));
const press = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

/** A promise the test settles by hand. */
function gate() {
  let open: () => void = () => {};
  let fail: (error: Error) => void = () => {};
  const promise = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  return { promise, open, fail };
}

describe("botao-clique: the shared button answers a click", () => {
  test("a button that is disabled says why, next to it, and the reason is tied to the button", async () => {
    render(
      <Button disabled disabledReason="Escreva o primeiro prompt">
        Criar
      </Button>,
    );
    const button = screen.queryByRole("button", { name: "Criar" }) as HTMLButtonElement | null;
    expect(button?.disabled).toBe(true);
    const reason = screen.queryByText("Escreva o primeiro prompt");
    expect(reason).not.toBeNull();
    expect(button?.getAttribute("aria-describedby")).toBe(reason?.id ?? "x");
  });

  test("a reason on a button that is not disabled is not shown", async () => {
    render(<Button disabledReason="Escreva o primeiro prompt">Criar</Button>);
    expect(screen.queryByText("Escreva o primeiro prompt")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Criar" })?.getAttribute("aria-describedby"),
    ).toBeNull();
  });

  test("pending: busy at once, disabled, with a spinner, and it keeps its label", async () => {
    render(<Button pending>Salvar</Button>);
    const button = screen.queryByRole("button", { name: /Salvar/ }) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-busy")).toBe("true");
    expect(button?.disabled).toBe(true);
    expect(button?.querySelector("svg.animate-spin")).not.toBeNull();
    expect(button?.textContent).toContain("Salvar");
  });

  test("a click whose handler returns a promise is pending until it settles, and a second click does nothing", async () => {
    const work = gate();
    let calls = 0;
    render(
      <Button
        onClick={() => {
          calls++;
          return work.promise;
        }}
      >
        Abrir
      </Button>,
    );
    await press("Abrir");
    const during = screen.queryByRole("button", { name: /Abrir/ }) as HTMLButtonElement | null;
    expect(during?.getAttribute("aria-busy")).toBe("true");
    await press("Abrir");
    expect(calls).toBe(1);
    work.open();
    await tick();
    const after = screen.queryByRole("button", { name: /Abrir/ }) as HTMLButtonElement | null;
    expect(after?.getAttribute("aria-busy")).toBeNull();
    expect(after?.disabled).toBe(false);
  });

  test("a handler that fails does not leave the button stuck", async () => {
    const work = gate();
    render(<Button onClick={() => work.promise.catch(() => {})}>Abrir</Button>);
    await press("Abrir");
    work.fail(new Error("falhou"));
    await tick();
    expect(
      (screen.queryByRole("button", { name: /Abrir/ }) as HTMLButtonElement | null)?.disabled,
    ).toBe(false);
  });

  test("a plain click handler is not pending: it answers at once, as before", async () => {
    let calls = 0;
    render(
      <Button
        onClick={() => {
          calls++;
        }}
      >
        Ir
      </Button>,
    );
    await press("Ir");
    await press("Ir");
    expect(calls).toBe(2);
    expect(screen.queryByRole("button", { name: "Ir" })?.getAttribute("aria-busy")).toBeNull();
  });

  test("two clicks in the same event run the handler once", async () => {
    const work = gate();
    let calls = 0;
    render(
      <Button
        onClick={() => {
          calls++;
          return work.promise;
        }}
      >
        Abrir
      </Button>,
    );
    const button = screen.queryByRole("button", { name: "Abrir" }) as HTMLElement;
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(calls).toBe(1);
    work.open();
    await tick();
  });
});
