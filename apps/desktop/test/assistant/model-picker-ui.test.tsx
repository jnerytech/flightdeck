import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ModelOption } from "@flightdeck/protocol";
import { translator } from "../../src/i18n/index.ts";
import { liveScreen, registerDom } from "../dom.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ModelPicker } = await import("../../src/features/assistant/model-picker.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const OPTIONS: ModelOption[] = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5", group: "Haiku" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", group: "Sonnet" },
];

function mount(value: string | null) {
  render(
    <ModelPicker
      t={translator("en")}
      label="Quick model"
      defaultLabel="Suggested default"
      options={OPTIONS}
      value={value}
      onChange={() => {}}
    />,
  );
}

/** Whether the row carries the mark of the chosen one: a boolean, so a failed check prints no DOM node. */
const marked = (name: RegExp) =>
  screen.queryByRole("option", { name })?.querySelector("[data-chosen]") != null;

describe("model-picker-ui: what the list says about itself", () => {
  test("the chosen row carries a visible mark, and no other row does", () => {
    mount("claude-sonnet-5-5");
    expect(marked(/Sonnet 5.5/)).toBe(true);
    expect(marked(/Haiku 5.5/)).toBe(false);
    expect(marked(/Suggested default/)).toBe(false);
  });

  test("the default row carries the mark when no model is chosen", () => {
    mount(null);
    expect(marked(/Suggested default/)).toBe(true);
    expect(marked(/Sonnet 5.5/)).toBe(false);
  });

  test("the list has a name of its own, apart from the field that filters it", () => {
    mount(null);
    expect(screen.queryByRole("combobox", { name: "Quick model" })).not.toBeNull();
    expect(screen.queryByRole("listbox", { name: "Quick model: models" })).not.toBeNull();
    expect(screen.queryByRole("listbox", { name: "Quick model" })).toBeNull();
  });
});
