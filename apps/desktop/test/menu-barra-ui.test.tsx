import { afterEach, describe, expect, test } from "bun:test";
import { useRef, useState } from "react";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { PromptMenu } = await import("../src/components/snippets/prompt-menu.tsx");

afterEach(cleanup);

const snippets = {
  list: async () => [
    { key: "s1", name: "revisar", description: "Revisa o PR atual" },
    { key: "slash:compact", name: "/compact" },
    { key: "slash:review", name: "/review", description: "Review a pull request" },
    { key: "slash:plug:brainstorm", name: "/plug:brainstorm" },
    { key: "slash:mcp__gh__issue", name: "/mcp__gh__issue" },
  ],
  fill: async (key: string) => `filled:${key}`,
};

function Harness(props: { start?: string }) {
  const [text, setText] = useState(props.start ?? "/");
  const input = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <textarea
        ref={input}
        aria-label="Mensagem"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <PromptMenu prompts={snippets} text={text} label="Snippets" onFill={setText} input={input} />
    </>
  );
}

const box = () => screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
const key = async (k: string) => act(async () => void fireEvent.keyDown(box(), { key: k }));
const open = async (start?: string) => {
  render(<Harness {...(start ? { start } : {})} />);
  await act(async () => {});
};

describe("menu-barra: the / menu of a message box", () => {
  test("the items come in groups with a heading and a count", async () => {
    await open();
    const groups = screen.getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([
      "Comandos (2)",
      "Snippets (1)",
      "Skills (1)",
      "Prompts MCP (1)",
    ]);
  });

  test("while it is open the box is a combobox that points at the list and the selected option", async () => {
    await open();
    const list = screen.getByRole("listbox", { name: "Snippets" });
    const combo = screen.getByRole("combobox", { name: "Mensagem" });
    expect(combo.getAttribute("aria-expanded")).toBe("true");
    expect(combo.getAttribute("aria-controls")).toBe(list.id);
    const first = screen.getAllByRole("option")[0] as HTMLElement;
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(combo.getAttribute("aria-activedescendant")).toBe(first.id);
  });

  test("the arrows, Home and End move the selection, and Enter fills the selected one", async () => {
    await open();
    const options = () => screen.getAllByRole("option");
    const selected = () => options().findIndex((o) => o.getAttribute("aria-selected") === "true");
    expect(selected()).toBe(0);
    await key("ArrowDown");
    expect(selected()).toBe(1);
    await key("End");
    expect(selected()).toBe(options().length - 1);
    await key("ArrowDown");
    expect(selected()).toBe(0);
    await key("ArrowUp");
    expect(selected()).toBe(options().length - 1);
    await key("Home");
    await key("Enter");
    await act(async () => {});
    expect(box().value).toBe("/compact ");
  });

  test("Escape closes the menu and the box goes back to a plain text box", async () => {
    await open();
    await key("Escape");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(box().value).toBe("/");
  });

  test("typing filters as you go, on the name and on the description, and marks the match", async () => {
    await open("/rvw");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["/review"]);
    await act(async () => void fireEvent.change(box(), { target: { value: "/pull" } }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["/review"]);
    await act(async () => void fireEvent.change(box(), { target: { value: "/rev" } }));
    const marks = Array.from(screen.getAllByRole("option")[0]?.querySelectorAll("mark") ?? []);
    expect(marks.map((m) => m.textContent)).toEqual(["rev"]);
  });

  test("the description of the selected item is shown, and follows the selection", async () => {
    await open("/rev");
    const shown = () => screen.queryByTestId("prompt-menu-description")?.textContent;
    expect(shown()).toBe("Review a pull request");
    await act(async () => void fireEvent.change(box(), { target: { value: "/" } }));
    await key("ArrowDown");
    expect(shown()).toBe("Review a pull request");
    await key("Home");
    expect(shown() ?? "").toBe("");
  });
});
