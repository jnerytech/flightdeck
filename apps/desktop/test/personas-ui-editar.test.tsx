import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { personasHost } from "./personas-ui-setup.ts";
import { settle, uiIdle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** The elements the page asked to scroll into view, in order. */
const scrolled: Element[] = [];

async function open(
  before?: (store: InstanceType<typeof AppStore>, hostId: string) => Promise<unknown>,
) {
  scrolled.length = 0;
  const record = function (this: Element) {
    scrolled.push(this);
  };
  (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = record;
  (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = record;
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await personasHost(cleanups, store);
  await before?.(store, h.hostId);
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: "Personas" }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: "Personas" }) as HTMLElement);
  });
  await settle(() => screen.queryByRole("list", { name: "Personas" }) !== null);
  return { store, ...h };
}

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
  await uiIdle();
}
const button = (name: string) => screen.getByRole("button", { name });
const items = () => [...screen.getByRole("list", { name: "Personas" }).children] as HTMLElement[];
const viewport = () => document.querySelector("[data-slot='scroll-area-viewport']") as HTMLElement;

describe("personas-ui-editar: Edit opens where the persona is (issue #134)", () => {
  test("Edit on the last persona expands its own card into the form, focuses the first field and scrolls it into view", async () => {
    await open();
    const last = items().at(-1) as HTMLElement;
    const name = last.querySelector("[data-name]")?.textContent as string;
    await click(within(last).getByRole("button", { name: `Editar ${name}` }));
    // The form is inside that card, not on top of the page.
    const form = last.querySelector("form") as HTMLElement;
    expect(form).not.toBeNull();
    expect(screen.getAllByRole("textbox", { name: "Nome" })).toHaveLength(1);
    expect(within(form).getByLabelText("Nome") === document.activeElement).toBe(true);
    expect(scrolled.some((el) => el.tagName === "FORM" && last.contains(el))).toBe(true);
    // The other cards are still there, with their own Edit buttons.
    expect(items().length).toBeGreaterThan(1);
  });

  test("Cancel puts the card back, restores the scroll and gives the focus back to its Edit button", async () => {
    await open();
    const last = items().at(-1) as HTMLElement;
    const name = last.querySelector("[data-name]")?.textContent as string;
    viewport().scrollTop = 321;
    await click(within(last).getByRole("button", { name: `Editar ${name}` }));
    viewport().scrollTop = 0;
    await click(within(last).getByRole("button", { name: "Cancelar" }));
    expect(last.querySelector("form")).toBeNull();
    expect(document.activeElement === button(`Editar ${name}`)).toBe(true);
    expect(viewport().scrollTop).toBe(321);
  });

  test("Save does the same", async () => {
    await open();
    const last = items().at(-1) as HTMLElement;
    const name = last.querySelector("[data-name]")?.textContent as string;
    viewport().scrollTop = 200;
    await click(within(last).getByRole("button", { name: `Editar ${name}` }));
    viewport().scrollTop = 0;
    await click(within(last).getByRole("button", { name: "Salvar persona" }));
    await settle(() => screen.queryByRole("button", { name: `Editar ${name}` }) !== null);
    expect(document.activeElement === button(`Editar ${name}`)).toBe(true);
    expect(viewport().scrollTop).toBe(200);
  });

  test("a new persona still opens at the top, with the first field (Id) focused", async () => {
    await open();
    await click(button("Nova persona"));
    const id = screen.getByLabelText("Id");
    expect(id === document.activeElement).toBe(true);
    expect(items().every((li) => li.querySelector("form") === null)).toBe(true);
  });
});

describe("personas-ui-editar: model and tools are choices (issue #134)", () => {
  test("Model is a select of the known models, with Other… for free text", async () => {
    await open();
    await click(button("Nova persona"));
    const model = screen.getByLabelText("Modelo") as HTMLSelectElement;
    expect(model.tagName).toBe("SELECT");
    const values = [...model.options].map((o) => o.value);
    expect(values).toEqual(
      expect.arrayContaining(["", "opus", "sonnet", "haiku", "claude-sonnet-5-5", "__other__"]),
    );
    expect(screen.queryByLabelText("Outro modelo")).toBeNull();
    await act(async () => {
      fireEvent.change(model, { target: { value: "__other__" } });
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Outro modelo"), { target: { value: "claude-x-9" } });
    });
    expect(screen.getByRole("region", { name: "Prévia" }).textContent).toContain("claude-x-9");
  });

  test("a persona whose model is not in the list opens on Other… with its model typed", async () => {
    await open((store, hostId) =>
      store.hostRequest(hostId, "personas.save", {
        scope: "host",
        persona: {
          id: "estranha",
          name: "Estranha",
          description: "d",
          body: "b",
          model: "claude-x-9",
        },
      } as never),
    );
    await settle(() => screen.queryByRole("button", { name: "Editar Estranha" }) !== null);
    await click(button("Editar Estranha"));
    expect((screen.getByLabelText("Modelo") as HTMLSelectElement).value).toBe("__other__");
    expect((screen.getByLabelText("Outro modelo") as HTMLInputElement).value).toBe("claude-x-9");
  });

  test("Tools is a multi-select of the known tools; what is picked is what the preview says", async () => {
    await open();
    await click(button("Nova persona"));
    const tools = screen.getByLabelText("Ferramentas") as HTMLSelectElement;
    expect(tools.tagName).toBe("SELECT");
    expect(tools.multiple).toBe(true);
    expect([...tools.options].map((o) => o.value)).toEqual(
      expect.arrayContaining(["Read", "Grep", "Glob", "Bash", "Edit", "Write"]),
    );
    await act(async () => {
      for (const option of tools.options) option.selected = ["Read", "Grep"].includes(option.value);
      fireEvent.change(tools);
    });
    expect(screen.getByRole("region", { name: "Prévia" }).textContent).toContain(
      "Ferramentas: só Read, Grep, e nenhuma que a sessão não tenha",
    );
  });
});
