import { afterEach, describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../src/i18n/context.tsx");
const { Dialog, DialogTitle } = await import("../src/components/ui/dialog.tsx");
const { AppDialogContent } = await import("../src/components/feedback/dialog-content.tsx");

afterEach(cleanup);

function open(lang: "pt-BR" | "en", onOpenChange = (_open: boolean) => {}) {
  render(
    <TContext.Provider value={translator(lang)}>
      <Dialog open onOpenChange={onOpenChange}>
        <AppDialogContent aria-describedby={undefined}>
          <DialogTitle>Título</DialogTitle>
        </AppDialogContent>
      </Dialog>
    </TContext.Provider>,
  );
}

describe("dialogo-fechar", () => {
  test("the × is named from the dictionary: Fechar in pt-BR, with no English Close", () => {
    open("pt-BR");
    expect(screen.queryByRole("button", { name: "Fechar" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  test("in English it says Close, and the button closes the dialog", () => {
    const calls: boolean[] = [];
    open("en", (value) => calls.push(value));
    const button = screen.queryByRole("button", { name: "Close" });
    expect(button).not.toBeNull();
    fireEvent.click(button as HTMLElement);
    expect(calls).toEqual([false]);
  });

  test("the × is a target of at least 24 px", () => {
    open("pt-BR");
    const button = screen.queryByRole("button", { name: "Fechar" });
    expect(button?.className ?? "").toContain("size-6");
  });
});
