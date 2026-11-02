import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { IconActionButton } = await import("../src/components/feedback/icon-action-button.tsx");

afterEach(cleanup);

describe("botao-icone: a header action as an icon with a name", () => {
  test("it has no visible text, is named by its label, and says the label in a tooltip", async () => {
    let clicks = 0;
    render(
      <IconActionButton label="Copiar comando" onClick={() => void clicks++}>
        <svg aria-hidden="true" />
      </IconActionButton>,
    );
    const button = screen.queryByRole("button", { name: "Copiar comando" }) as HTMLElement;
    expect(button).not.toBeNull();
    expect(button.textContent).toBe("");
    expect(button.className).toContain("size-8");
    await act(async () => void fireEvent.focus(button));
    await act(async () => {});
    expect(screen.queryAllByText("Copiar comando").length).toBeGreaterThan(0);
    await act(async () => void fireEvent.click(button));
    expect(clicks).toBe(1);
  });
});
