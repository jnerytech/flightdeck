import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type AxeViolation, blocking, describeViolation } from "../../../scripts/lib/axe.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

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
    expect(items).toHaveLength(3);
    expect((list as HTMLElement).tagName).toBe("OL");
    expect(items[0]?.textContent).toContain("flightdeckd setup");
    expect(items[2]?.textContent).toContain("Testar e adicionar");
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

  test("the same screen in English", async () => {
    firstRun("en");
    await act(async () => {});
    expect(screen.queryByRole("list", { name: "First steps" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Copy flightdeckd setup" })).not.toBeNull();
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
