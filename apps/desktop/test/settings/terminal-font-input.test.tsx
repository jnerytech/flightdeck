import { afterEach, describe, expect, test } from "bun:test";
import { chooseFromAccountMenu } from "../account/menu.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle } from "../wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { TERMINAL_FONT_KEY } = await import("../../src/features/terminal/terminal-view.ts");
const { App } = await import("../../src/app/App.tsx");

afterEach(() => cleanup());

async function openSettings(language: string, label: string, stored = "13") {
  const mem = memoryPlatform(false, language);
  mem.platform.storage.setItem(TERMINAL_FONT_KEY, stored);
  const store = new AppStore(mem.platform);
  render(<App store={store} />);
  await chooseFromAccountMenu(language === "en" ? "Settings" : "Configurações");
  await settle(() => screen.queryByLabelText(label) !== null);
  const box = screen.queryByLabelText(label) as HTMLInputElement | null;
  expect(box).not.toBeNull();
  return { store, box: box as HTMLInputElement, mem };
}

const LABEL = "Tamanho da fonte do terminal";
const type = (box: HTMLInputElement, text: string) =>
  fireEvent.change(box, { target: { value: text } });

describe("terminal font size box (#2594)", () => {
  test("clearing the box and typing 1 then 4 shows 14 and stores 14 on blur", async () => {
    const { store, box, mem } = await openSettings("pt-BR", LABEL);
    type(box, "");
    type(box, "1");
    expect(box.value).toBe("1");
    type(box, "14");
    expect(box.value).toBe("14");
    fireEvent.blur(box);
    expect(box.value).toBe("14");
    expect(store.terminalFont.value).toBe(14);
    expect(mem.platform.storage.getItem(TERMINAL_FONT_KEY)).toBe("14");
  });

  test("99 and Enter stores the largest size and shows it", async () => {
    const { store, box } = await openSettings("pt-BR", LABEL);
    type(box, "99");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(store.terminalFont.value).toBe(24);
    expect(box.value).toBe("24");
  });

  test("5 and leaving the box stores the smallest size and shows it", async () => {
    const { store, box } = await openSettings("pt-BR", LABEL);
    type(box, "5");
    fireEvent.blur(box);
    expect(store.terminalFont.value).toBe(10);
    expect(box.value).toBe("10");
  });

  test("an empty box on leaving shows the stored size again", async () => {
    const { store, box } = await openSettings("pt-BR", LABEL, "16");
    type(box, "");
    expect(box.value).toBe("");
    fireEvent.blur(box);
    expect(store.terminalFont.value).toBe(16);
    expect(box.value).toBe("16");
  });

  test("the allowed range is written next to the box, in both languages", async () => {
    await openSettings("pt-BR", LABEL);
    expect(screen.queryByText("Entre 10 e 24 px.") !== null).toBe(true);
    cleanup();
    await openSettings("en", "Terminal font size");
    expect(screen.queryByText("Between 10 and 24 px.") !== null).toBe(true);
  });

  test("the box is tied to the range text for a screen reader", async () => {
    const { box } = await openSettings("pt-BR", LABEL);
    const id = box.getAttribute("aria-describedby");
    expect(id).not.toBeNull();
    expect(document.getElementById(id as string)?.textContent).toBe("Entre 10 e 24 px.");
  });
});
