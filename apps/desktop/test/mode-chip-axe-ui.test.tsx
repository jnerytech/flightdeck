import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ReactNode } from "react";
import { AXE_RUN_OPTIONS, blocking, describeViolation } from "../../../scripts/lib/axe.ts";
import { translator } from "../src/i18n/index.ts";
import { modeRows } from "../src/lib/mode-menu.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ModeChip } = await import("../src/components/session/mode-chip.tsx");
const { ModelChip } = await import("../src/components/session/model-chip.tsx");
const axe = (await import("axe-core")).default;

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * The session screen around a chip: a header with a control, and a live region next to the chip
 * (the working row, the scope menu's count). A modal menu marks the rest of the page aria-hidden
 * with its controls still focusable, which axe blocks.
 */
function page(chip: ReactNode) {
  render(
    <div>
      <header>
        <button type="button">Back</button>
      </header>
      <main>
        <output aria-live="polite">working</output>
        {chip}
      </main>
    </div>,
  );
}

const rows = modeRows({ current: "default", start: "default", bypassAllowed: false });

function modeChip(lang: "en" | "pt-BR", picked: string[] = []) {
  return (
    <ModeChip
      t={translator(lang)}
      mode="default"
      rows={rows}
      onPick={(mode) => {
        picked.push(mode);
      }}
    />
  );
}

function modelChip(lang: "en" | "pt-BR") {
  return (
    <ModelChip
      t={translator(lang)}
      model=""
      current={undefined}
      effort={null}
      effortAvailable={false}
      onPickModel={() => undefined}
      onPickEffort={() => undefined}
    />
  );
}

/** Opens the chip named `name` with the keyboard and waits for its menu. */
async function openChip(name: string): Promise<HTMLElement> {
  const trigger = screen.queryByRole("button", { name });
  expect(trigger).not.toBeNull();
  await act(async () => {
    fireEvent.keyDown(trigger as HTMLElement, { key: "Enter" });
  });
  await settle(() => screen.queryByRole("menu") !== null, undefined, "the chip's menu");
  return trigger as HTMLElement;
}

async function axeBlocking(): Promise<string[]> {
  const result = await axe.run(document.body, AXE_RUN_OPTIONS);
  return blocking(result.violations as Parameters<typeof blocking>[0]).map((v) =>
    describeViolation("chip", v),
  );
}

describe("mode-chip: the chips' menus next to a live region", () => {
  for (const [lang, mode, model] of [
    ["en", "Permission mode: Default", "Model: Default model"],
    ["pt-BR", "Modo de permissão: Padrão", "Modelo: Modelo padrão"],
  ] as const) {
    test(`${lang}: Given the Mode menu is open, Then axe blocks nothing on the page`, async () => {
      page(modeChip(lang));
      await openChip(mode);
      expect(await axeBlocking()).toEqual([]);
    });

    test(`${lang}: Given the Model menu is open, Then axe blocks nothing on the page`, async () => {
      page(modelChip(lang));
      await openChip(model);
      expect(await axeBlocking()).toEqual([]);
    });
  }

  // Radix puts the focus back on a chip a tick after a pick; a menu opened again within that tick
  // (the same chip's, or the other chip's) took it as a focus outside and closed, which a slow full
  // run hit. Like a modal menu, a chip's menu closes on Escape or a press outside, not on a focus.
  for (const [name, chip] of [
    ["Mode", modeChip("en")],
    ["Model", modelChip("en")],
  ] as const) {
    for (const target of ["its own chip", "another control"] as const) {
      test(`the open ${name} menu stays open when the focus lands on ${target}`, async () => {
        page(chip);
        const trigger = await openChip(
          name === "Mode" ? "Permission mode: Default" : "Model: Default model",
        );
        const back = screen.queryByRole("button", { name: "Back", hidden: true });
        expect(back).not.toBeNull();
        await act(async () => {
          (target === "its own chip" ? trigger : (back as HTMLElement)).focus();
        });
        expect(screen.queryByRole("menu") !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
      });
    }
  }

  test("the open Mode menu takes the focus, a number key picks its row, and Escape closes it", async () => {
    const picked: string[] = [];
    page(modeChip("en", picked));
    await openChip("Permission mode: Default");
    const menu = screen.queryByRole("menu") as HTMLElement;
    expect(menu.contains(document.activeElement)).toBe(true);
    await act(async () => {
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "3" });
    });
    expect(picked).toEqual(["plan"]);
    cleanup();
    page(modeChip("en"));
    const trigger = await openChip("Permission mode: Default");
    await act(async () => {
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    });
    await settle(() => screen.queryByRole("menu") === null, undefined, "the menu to close");
    await settle(() => document.activeElement === trigger, undefined, "the focus back on the chip");
  });
});
