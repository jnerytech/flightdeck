import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { AXE_RUN_OPTIONS, blocking, describeViolation } from "../../../scripts/lib/axe.ts";
import { translator } from "../src/i18n/index.ts";
import { modeRows } from "../src/lib/mode-menu.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ModeChip } = await import("../src/components/session/mode-chip.tsx");
const axe = (await import("axe-core")).default;

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * The session screen around the chip: a header with a control, and a live region next to the
 * chip (the working row, the scope menu's count). An open menu that hides the page keeps a live
 * region heard, so the chrome around it is hidden piece by piece, with its controls still focusable.
 */
function setup(lang: "en" | "pt-BR") {
  const t = translator(lang);
  const rows = modeRows({ current: "default", start: "default", bypassAllowed: false });
  render(
    <div>
      <header>
        <button type="button">Back</button>
      </header>
      <main>
        <output aria-live="polite">working</output>
        <ModeChip t={t} mode="default" rows={rows} onPick={() => undefined} />
      </main>
    </div>,
  );
}

describe("mode-chip: the open Mode menu", () => {
  for (const [lang, chip] of [
    ["en", "Permission mode: Default"],
    ["pt-BR", "Modo de permissão: Padrão"],
  ] as const) {
    test(`${lang}: Given the menu is open next to a live region, Then axe blocks nothing on the page`, async () => {
      setup(lang);
      const trigger = screen.queryByRole("button", { name: chip });
      expect(trigger).not.toBeNull();
      await act(async () => {
        fireEvent.keyDown(trigger as HTMLElement, { key: "Enter" });
      });
      await settle(() => screen.queryByRole("menu") !== null, undefined, "the Mode menu");
      const result = await axe.run(document.body, AXE_RUN_OPTIONS);
      expect(
        blocking(result.violations as Parameters<typeof blocking>[0]).map((v) =>
          describeViolation("mode-chip", v),
        ),
      ).toEqual([]);
    });
  }
});
