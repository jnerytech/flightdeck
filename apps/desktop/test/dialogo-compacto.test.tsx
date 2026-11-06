import { afterEach, describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { registerDom } from "./dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { cleanup, render } = await import("@testing-library/react");
const { TContext } = await import("../src/i18n/context.tsx");
const { Dialog, DialogFooter, DialogTitle } = await import("../src/components/ui/dialog.tsx");
const { AppDialogContent } = await import("../src/components/feedback/dialog-content.tsx");
const { ConfirmDialog } = await import("../src/ui/ConfirmDialog.tsx");

afterEach(cleanup);

const classesOf = (slot: string) =>
  document.querySelector(`[data-slot=${slot}]`)?.className.split(/\s+/) ?? [];

/** The classes that make a dialog the full-screen sheet below 640 px (`max-sm:`). */
const SHEET = [
  "max-sm:inset-0",
  "max-sm:max-w-none",
  "max-sm:translate-none",
  "max-sm:rounded-none",
  "max-sm:flex",
  "max-sm:flex-col",
  "max-sm:overflow-y-auto",
];

// Issue #641, responsive spec "Dialogs": at 640 px and up a dialog stays centered; below it, it is
// a full-screen sheet whose body scrolls and whose footer stays at the bottom, the buttons stacked
// with the primary last. happy-dom does not evaluate media queries, so the classes are the proof;
// the prints check the screen.
describe("dialogo-compacto: below 640 px a dialog is a full-screen sheet", () => {
  test("the dialog's content fills the window and scrolls; at 640 px and up it stays centered", () => {
    render(
      <TContext.Provider value={translator("en")}>
        <Dialog open>
          <AppDialogContent aria-describedby={undefined}>
            <DialogTitle>New card</DialogTitle>
            <p>Body</p>
            <DialogFooter>
              <button type="button">Cancel</button>
              <button type="button">Create</button>
            </DialogFooter>
          </AppDialogContent>
        </Dialog>
      </TContext.Provider>,
    );
    const content = classesOf("dialog-content");
    expect(SHEET.filter((c) => !content.includes(c))).toEqual([]);
    expect(content.includes("sm:max-w-lg")).toBe(true);
    const footer = classesOf("dialog-footer");
    // Pinned to the bottom of the sheet, the buttons stacked in their order: the primary last.
    expect(
      ["max-sm:sticky", "max-sm:bottom-0", "max-sm:mt-auto", "flex-col"].filter(
        (c) => !footer.includes(c),
      ),
    ).toEqual([]);
    expect(footer.includes("flex-col-reverse")).toBe(false);
  });

  test("a confirmation stays a centered box: a two-line question does not take the screen", () => {
    render(
      <TContext.Provider value={translator("en")}>
        <ConfirmDialog message="End it?" onCancel={() => {}} onConfirm={() => {}} />
      </TContext.Provider>,
    );
    const content = classesOf("alert-dialog-content");
    expect(content.length > 0).toBe(true);
    expect(content.includes("max-sm:inset-0")).toBe(false);
  });
});
