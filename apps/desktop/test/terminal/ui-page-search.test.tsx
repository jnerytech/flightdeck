import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  act,
  click,
  escapeReachesPageUnhandled,
  fireEvent,
  runCleanups,
  screen,
  settle,
  setup,
  state,
} from "./page-setup.tsx";

setDefaultTimeout(30_000);
afterEach(runCleanups);

describe("terminal-ui: the search bar", () => {
  test("Ctrl+Shift+F opens the search: Enter goes to the next match, Shift+Enter to the previous, Esc closes", async () => {
    const { x } = await setup();
    await settle(() => state("Ao vivo"));
    act(() => void x.chord("F"));
    const box = screen.queryByRole("searchbox", { name: "Buscar no terminal" });
    expect(box).not.toBeNull();
    await act(async () => {
      fireEvent.change(box as HTMLElement, { target: { value: "erro" } });
      fireEvent.keyDown(box as HTMLElement, { key: "Enter" });
      fireEvent.keyDown(box as HTMLElement, { key: "Enter", shiftKey: true });
    });
    expect(x.finds).toContain("next:erro");
    expect(x.finds).toContain("prev:erro");
    await act(async () => {
      fireEvent.keyDown(box as HTMLElement, { key: "Escape" });
    });
    expect(screen.queryByRole("searchbox", { name: "Buscar no terminal" })).toBeNull();
    expect(x.finds.at(-1)).toBe("clear");
  });

  test("Esc in the search box closes the search and marks the key handled", async () => {
    const { x } = await setup();
    await settle(() => state("Ao vivo"));
    act(() => void x.chord("F"));
    const box = screen.queryByRole("searchbox", { name: "Buscar no terminal" });
    expect(box).not.toBeNull();
    expect(await escapeReachesPageUnhandled(box as HTMLElement)).toBe(false);
  });

  test("typing in the search finds as you go, keeping the match; emptying the box clears it", async () => {
    const { x } = await setup();
    await settle(() => state("Ao vivo"));
    act(() => void x.chord("F"));
    const box = screen.queryByRole("searchbox", { name: "Buscar no terminal" }) as HTMLElement;
    await act(async () => {
      fireEvent.change(box, { target: { value: "er" } });
    });
    expect(x.finds.at(-1)).toBe("next:er");
    expect(x.findOptions.at(-1)).toMatchObject({ incremental: true });
    await act(async () => {
      fireEvent.change(box, { target: { value: "" } });
    });
    expect(x.finds.at(-1)).toBe("clear");
  });

  test("the search has Diferenciar maiúsculas, Palavra inteira and Expressão regular, by click and by Alt+C/W/R (issue #476)", async () => {
    const { x } = await setup();
    await settle(() => state("Ao vivo"));
    act(() => void x.chord("F"));
    const box = screen.queryByRole("searchbox", { name: "Buscar no terminal" }) as HTMLElement;
    const toggle = (name: string) => screen.queryByRole("button", { name });
    expect(toggle("Diferenciar maiúsculas e minúsculas")?.getAttribute("aria-pressed")).toBe(
      "false",
    );
    await click("Diferenciar maiúsculas e minúsculas");
    await act(async () => {
      fireEvent.keyDown(box, { key: "w", altKey: true });
      fireEvent.change(box, { target: { value: "Er" } });
    });
    expect(x.findOptions.at(-1)).toMatchObject({ caseSensitive: true, wholeWord: true });
    expect(toggle("Palavra inteira")?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      fireEvent.keyDown(box, { key: "r", altKey: true });
      fireEvent.change(box, { target: { value: "a(" } });
    });
    expect(toggle("Usar expressão regular")?.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("Expressão regular inválida")).not.toBeNull();
    expect(x.finds.at(-1)).toBe("clear");
  });

  test("the search says where the current match is, or that there is none", async () => {
    const { x } = await setup();
    await settle(() => state("Ao vivo"));
    act(() => void x.chord("F"));
    const box = screen.queryByRole("searchbox", { name: "Buscar no terminal" }) as HTMLElement;
    await act(async () => {
      fireEvent.change(box, { target: { value: "erro" } });
      x.foundResults(1, 5);
    });
    expect(screen.queryByText("2 de 5")).not.toBeNull();
    await act(async () => {
      x.foundResults(-1, 0);
    });
    expect(screen.queryByText("2 de 5")).toBeNull();
    expect(screen.queryByText("Nenhum resultado")).not.toBeNull();
  });

  test("the search bar has buttons for the next and previous match and for closing", async () => {
    const { x } = await setup();
    await settle(() => state("Ao vivo"));
    act(() => void x.chord("F"));
    const box = screen.queryByRole("searchbox", { name: "Buscar no terminal" }) as HTMLElement;
    await act(async () => {
      fireEvent.change(box, { target: { value: "erro" } });
    });
    await click("Próximo resultado");
    expect(x.finds.at(-1)).toBe("next:erro");
    await click("Resultado anterior");
    expect(x.finds.at(-1)).toBe("prev:erro");
    await click("Fechar busca");
    expect(screen.queryByRole("searchbox", { name: "Buscar no terminal" })).toBeNull();
    expect(x.finds.at(-1)).toBe("clear");
  });
});
