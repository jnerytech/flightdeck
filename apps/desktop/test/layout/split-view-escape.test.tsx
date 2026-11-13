import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { waiter } from "../wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SplitView } = await import("../../src/shared/layout/split-view.tsx");
const { ConfirmDialog } = await import("../../src/shared/feedback/index.ts");

const settle = waiter(4000);

afterEach(cleanup);

/** A ResizeObserver the test fires with the width it wants: 500 shows one pane, 0 (never fired) both. */
function narrowArea() {
  const saved = globalThis.ResizeObserver;
  const fire: Array<(width: number) => void> = [];
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      fire.push((width) =>
        callback([{ contentRect: { width } } as ResizeObserverEntry], this as ResizeObserver),
      );
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  return {
    shrink: () =>
      act(async () => {
        for (const run of fire) run(500);
      }),
    restore: () => {
      globalThis.ResizeObserver = saved;
    },
  };
}

/** The detail of a session: a confirmation it opened (as the end-session one does) and a plain button. */
function Detail(props: Readonly<{ dialog: boolean }>) {
  return (
    <div>
      <button type="button">sessão</button>
      {props.dialog && (
        <ConfirmDialog
          message="Encerrar a sessão?"
          confirmLabel="Encerrar sessão"
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      )}
    </div>
  );
}

function view(dialog: boolean, closes: string[]) {
  return render(
    <SplitView
      list={<p>lista</p>}
      detail={<Detail dialog={dialog} />}
      empty={<p>nada aberto</p>}
      onClose={() => closes.push("closed")}
      labels={{ resize: "Redimensionar a lista", back: "Voltar à lista" }}
    />,
  );
}

async function pressEscapeIn(element: HTMLElement) {
  await act(async () => {
    fireEvent.keyDown(element, { key: "Escape" });
  });
}

describe("SplitView: Esc closes the detail only when nothing else took the key (issue #2579)", () => {
  test("Esc on the detail with no dialog open closes it once", async () => {
    const closes: string[] = [];
    view(false, closes);
    await pressEscapeIn(screen.queryByRole("button", { name: "sessão" }) as HTMLElement);
    expect(closes).toEqual(["closed"]);
  });

  test("Esc in a dialog the detail opened dismisses the dialog and keeps the detail", async () => {
    const closes: string[] = [];
    view(true, closes);
    const dialog = screen.queryByRole("alertdialog");
    expect(dialog).not.toBeNull();
    await settle(() => dialog?.contains(document.activeElement) === true);
    await pressEscapeIn(dialog as HTMLElement);
    expect(closes).toEqual([]);
  });

  test("the same holds in the narrow layout, where the detail is the only pane", async () => {
    const area = narrowArea();
    try {
      const closes: string[] = [];
      view(true, closes);
      await area.shrink();
      // The open dialog hides the rest of the page from the role queries, so the single pane is told by text.
      expect(screen.queryByText("Voltar à lista")).not.toBeNull();
      expect(screen.queryByText("lista")).toBeNull();
      const dialog = screen.queryByRole("alertdialog");
      expect(dialog).not.toBeNull();
      await settle(() => dialog?.contains(document.activeElement) === true);
      await pressEscapeIn(dialog as HTMLElement);
      expect(closes).toEqual([]);
    } finally {
      area.restore();
    }
  });
});
