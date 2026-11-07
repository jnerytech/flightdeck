import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type AxeViolation, blocking, describeViolation } from "../../../scripts/lib/axe.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const axe = (await import("axe-core")).default;

setDefaultTimeout(30_000);
afterEach(cleanup);

function firstRun(language = "pt-BR") {
  const mem = memoryPlatform(false, language);
  const copies: string[] = [];
  const platform = {
    ...mem.platform,
    copyText: async (text: string) => {
      copies.push(text);
    },
  };
  const store = new AppStore(platform);
  render(<App store={store} />);
  return { store, copies };
}

describe("primeira execução", () => {
  test("with no host the screen lists the numbered steps, each command with its own copy button", async () => {
    const { copies } = firstRun();
    await act(async () => {});
    const list = screen.queryByRole("list", { name: "Primeiros passos" });
    expect(list).not.toBeNull();
    const items = within(list as HTMLElement).queryAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect((list as HTMLElement).tagName).toBe("OL");
    expect(items[0]?.textContent).toContain("flightdeckd setup");
    expect(items[2]?.textContent).toContain("Testar e adicionar");
    expect(items[3]?.textContent).toContain("página do host");
    const copy = screen.queryByRole("button", { name: "Copiar flightdeckd setup" });
    expect(copy).not.toBeNull();
    await act(async () => {
      fireEvent.click(copy as HTMLElement);
    });
    expect(copies).toEqual(["flightdeckd setup"]);
  });

  test("below the steps, the troubleshooting command says what it does and can be copied", async () => {
    const { copies } = firstRun();
    await act(async () => {});
    const trouble = screen.queryByText(/Não conectou\?/);
    expect(trouble).not.toBeNull();
    const copy = screen.queryByRole("button", { name: "Copiar flightdeckd doctor" });
    expect(copy).not.toBeNull();
    await act(async () => {
      fireEvent.click(copy as HTMLElement);
    });
    expect(copies).toEqual(["flightdeckd doctor"]);
  });

  // #728 (journey pass #168): the screen centered its content in a box that scrolls, so when it
  // was taller than the window its top (the intro and step 1) sat above it, out of reach, and it
  // had no title. It is a page now: a title, the intro under it, and a body that scrolls from its top.
  test("the first-run screen is a page with a title, whose body scrolls from its top", async () => {
    firstRun("en");
    await act(async () => {});
    const title = screen.queryByRole("heading", { level: 1, name: "Connect your first host" });
    const steps = screen.queryByRole("list", { name: "First steps" });
    const page = title?.closest("[data-slot='page']") ?? null;
    const centered = [...document.querySelectorAll("main *")].filter((el) => {
      const classes = el.className.toString().split(/\s+/);
      return classes.includes("justify-center") && classes.includes("overflow-y-auto");
    }).length;
    expect({
      title: title !== null,
      stepsInPage: page !== null && steps !== null && page.contains(steps),
      intro:
        page?.textContent?.includes("Add a host with the flightdeckd address and token.") ?? false,
      centered,
    }).toEqual({ title: true, stepsInPage: true, intro: true, centered: 0 });
  });

  test("the same screen in English", async () => {
    firstRun("en");
    await act(async () => {});
    expect(screen.queryByRole("list", { name: "First steps" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Copy flightdeckd setup" })).not.toBeNull();
  });

  test("the first host added from the empty screen opens its page, where it is checked and its folders are chosen", async () => {
    const cleanups: Array<() => unknown> = [];
    const d = makeDaemon(cleanups, { firstRun: true });
    const server = d.listen();
    const { store } = firstRun();
    await act(async () => {});
    const type = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    type("Nome", "meu pc");
    type("Endereço", "127.0.0.1");
    type("Porta", String(server.port));
    type("Token", TOKEN);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Testar e adicionar" }));
    });
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && !screen.queryByText("Saúde e dependências")) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 25));
      });
    }
    expect(screen.queryByText("Saúde e dependências")).not.toBeNull();
    // The panel of the allowed folders (its field), not the words of the Health row that name it too.
    expect(screen.queryByLabelText("Pasta a permitir")).not.toBeNull();
    expect(store.getState().hosts).toHaveLength(1);
    store.dispose();
    for (const fn of cleanups.splice(0).reverse()) await fn();
  });

  test("the first-run screen has no blocking accessibility violation", async () => {
    firstRun();
    await act(async () => {});
    const result = await axe.run(document.body, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      blocking(result.violations as AxeViolation[]).map((v) => describeViolation("primeira", v)),
    ).toEqual([]);
  });
});
