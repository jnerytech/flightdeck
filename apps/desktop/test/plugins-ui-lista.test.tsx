import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { FakeCli } from "../../../scripts/test/fake-cli.ts";
import { inspectPlugin } from "../../daemon/src/plugins/inventory.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { pluginsHost } from "./plugins-ui-setup.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
const fakes: FakeCli[] = [];
afterEach(async () => {
  cleanup();
  // The daemon stops first: a request still in flight must not meet the sentinel `claude`.
  for (const fn of cleanups.splice(0).reverse()) await fn();
  for (const fake of fakes.splice(0)) fake.restore();
});

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(15));
}

/** The Plugins screen of a host that keeps them. */
async function open() {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await pluginsHost(cleanups, store, fakes);
  render(<App store={store} />);
  await settle(() => store.getState().hosts[0]?.hostInfo?.features?.includes("plugins") === true);
  await settle(() => screen.queryByRole("button", { name: "Plugins" }) !== null);
  const nav = screen.queryByRole("button", { name: "Plugins" });
  expect(nav).not.toBeNull();
  await act(async () => {
    fireEvent.click(nav as HTMLElement);
  });
  await settle(() => screen.queryByRole("heading", { name: "Plugins", level: 1 }) !== null);
  return { store, ...h };
}

async function tab(name: string) {
  await settle(() => screen.queryByRole("tab", { name }) !== null);
  const element = screen.queryByRole("tab", { name });
  expect(element).not.toBeNull();
  await act(async () => {
    fireEvent.mouseDown(element as HTMLElement, { button: 0 });
  });
}

const rows = (label: string) => [
  ...(screen.queryByRole("list", { name: label })?.querySelectorAll("li") ?? []),
];

describe("plugins-ui: a tela", () => {
  test("o item Plugins da barra abre a tela, com as três abas", async () => {
    await open();
    expect(screen.queryByRole("heading", { name: "Plugins", level: 1 })).not.toBeNull();
    await settle(() => screen.queryByRole("tab", { name: "Marketplaces" }) !== null);
    for (const name of ["Instalados", "Disponíveis", "Marketplaces"]) {
      expect(screen.queryByRole("tab", { name })).not.toBeNull();
    }
  });

  test("os instalados mostram versão, escopo, estado e o selo de atenção de quem escuta PreToolUse", async () => {
    await open();
    await settle(() => rows("Plugins instalados").length === 1);
    const [row] = rows("Plugins instalados");
    const text = row?.textContent ?? "";
    expect(text).toContain("deploy-tools");
    expect(text).toContain("1.2.0");
    expect(text).toContain("user");
    expect(text).toContain("Ativo");
    expect(text).toContain("Atenção: hooks sensíveis");
  });

  test("Ver o que instala mostra o manifesto, os hooks com os eventos, as skills e o hash do conteúdo", async () => {
    const { installed } = await open();
    await settle(() => rows("Plugins instalados").length === 1);
    const button = screen.queryByRole("button", { name: "Ver o que instala deploy-tools" });
    expect(button).not.toBeNull();
    await act(async () => {
      fireEvent.click(button as HTMLElement);
    });
    const dialog = await (async () => {
      await settle(
        () => screen.queryByRole("dialog", { name: "O que deploy-tools instala" }) !== null,
      );
      return screen.queryByRole("dialog", { name: "O que deploy-tools instala" });
    })();
    expect(dialog).not.toBeNull();
    const text = dialog?.textContent ?? "";
    expect(text).toContain("Publica o app");
    expect(text).toContain("PreToolUse (Bash): guard.sh");
    expect(text).toContain("Atenção: este hook pode decidir por você");
    expect(text).toContain("Skills: deploy");
    expect(text).toContain(`Hash do conteúdo: ${inspectPlugin(installed).hash.slice(0, 12)}`);
  });

  test("Disponíveis e Marketplaces listam o que o host oferece e de onde", async () => {
    await open();
    await tab("Disponíveis");
    await settle(() => rows("Plugins disponíveis").length === 2);
    expect(
      rows("Plugins disponíveis").map((r) => r.querySelector("[data-name]")?.textContent),
    ).toEqual(["outro", "remoto"]);
    await tab("Marketplaces");
    await settle(() => rows("Marketplaces configurados").length === 1);
    expect(rows("Marketplaces configurados")[0]?.textContent).toContain("acme");
  });
});
