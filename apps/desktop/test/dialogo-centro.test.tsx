import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";

registerDom();
const { cleanup, render } = await import("@testing-library/react");
const { Dialog, DialogContent, DialogDescription, DialogTitle } = await import(
  "../src/components/ui/dialog.tsx"
);

afterEach(cleanup);

describe("dialogo-centro: a dialog sits centered over a dimmed page", () => {
  test("it is centered by its own margins (no transform that a webview can drop) over a stronger dimmer", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Escolher</DialogTitle>
          <DialogDescription>Descrição</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const content = document.querySelector("[data-slot='dialog-content']") as HTMLElement;
    const overlay = document.querySelector("[data-slot='dialog-overlay']") as HTMLElement;
    expect(content.className).toContain("inset-0");
    expect(content.className).toContain("m-auto");
    expect(content.className).not.toContain("translate-x");
    expect(content.className).toContain("h-fit");
    expect(overlay.className).toContain("bg-black/60");
    expect(overlay.className).toContain("backdrop-blur-[1px]");
  });
});
