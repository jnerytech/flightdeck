import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TypedConfirm } = await import("../../src/features/vault/typed-confirm.tsx");

afterEach(cleanup);

function open() {
  const calls: string[] = [];
  render(
    <TypedConfirm
      message="O valor de github aparece por 10 s e some."
      word="revelar"
      inputLabel="Digite revelar para confirmar"
      confirmLabel="Revelar"
      onConfirm={() => calls.push("confirm")}
      onCancel={() => calls.push("cancel")}
    />,
  );
  return calls;
}

const box = () => screen.getByLabelText("Digite revelar para confirmar") as HTMLInputElement;
const type = (text: string) =>
  act(async () => {
    fireEvent.change(box(), { target: { value: text } });
  });
const enter = (init: { isComposing?: boolean } = {}) =>
  act(async () => {
    fireEvent.keyDown(box(), { key: "Enter", ...init });
  });

describe("typed confirmation (#2602)", () => {
  test("the word to type is written on screen as the box's own label, not only for a screen reader", () => {
    open();
    const label = document.querySelector("label");
    expect(label?.textContent).toBe("Digite revelar para confirmar");
    expect(label?.getAttribute("for")).toBe(box().id);
    expect(box().hasAttribute("aria-label")).toBe(false);
  });

  test("Enter in the box confirms when the word matches, whatever its case", async () => {
    const calls = open();
    await type(" REVELAR ");
    await enter();
    expect(calls).toEqual(["confirm"]);
  });

  test("Enter does nothing while the word is wrong", async () => {
    const calls = open();
    await type("mostrar");
    await enter();
    expect(calls).toEqual([]);
    expect(box().value).toBe("mostrar");
  });

  test("Enter that only ends an input-method composition does not confirm", async () => {
    const calls = open();
    await type("revelar");
    await enter({ isComposing: true });
    expect(calls).toEqual([]);
    await enter();
    expect(calls).toEqual(["confirm"]);
  });
});
