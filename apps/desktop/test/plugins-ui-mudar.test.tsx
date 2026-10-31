import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { FakeCli, FakeRule } from "../../../scripts/test/fake-cli.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { ok, pluginsHost, write } from "./plugins-ui-setup.ts";

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
  for (const fake of fakes.splice(0)) fake.restore();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(15));
}

const RULES = (_ctx: { installed: string; marketplace: string }): FakeRule[] => [
  { args: ["marketplace", "update"], stdout: ok("marketplace-update") },
  { args: ["marketplace", "add"], stdout: ok("marketplace-add") },
  { args: ["marketplace", "remove"], stdout: ok("marketplace-remove") },
  { args: ["update"], stdout: ok("update") },
  { args: ["uninstall"], stdout: ok("uninstall") },
];

async function open() {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await pluginsHost(cleanups, store, fakes, RULES);
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: "Plugins" }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: "Plugins" }) as HTMLElement);
  });
  await settle(() => screen.queryByRole("button", { name: "Atualizar deploy-tools" }) !== null);
  return h;
}

async function click(name: string | RegExp, role = "button") {
  const element = screen.queryByRole(role, { name });
  expect(element).not.toBeNull();
  await act(async () => {
    fireEvent.click(element as HTMLElement);
  });
  await act(() => Bun.sleep(150));
}

const calls = (fake: FakeCli) => fake.calls().map((c) => c.join(" "));
const changes = (fake: FakeCli) =>
  calls(fake).filter((c) => /^plugin (update|uninstall|marketplace (add|remove|update))/.test(c));
const dialog = (name: string) => screen.queryByRole("dialog", { name });

describe("plugins-ui: atualizar, fixar e remover", () => {
  test("Atualizar mostra de onde para onde e o que entra e sai; Cancelar não atualiza; confirmar atualiza e confere o que ficou", async () => {
    const { fake, marketplace } = await open();
    write(marketplace, {
      "plugins/deploy-tools/.claude-plugin/plugin.json": JSON.stringify({
        name: "deploy-tools",
        version: "1.3.0",
      }),
      "plugins/deploy-tools/hooks/hooks.json": JSON.stringify({
        hooks: { PermissionRequest: [{ hooks: [{ type: "command", command: "decide.sh" }] }] },
      }),
    });
    await click("Atualizar deploy-tools");
    await settle(() => (dialog("Atualizar deploy-tools")?.textContent ?? "").includes("→"));
    const text = dialog("Atualizar deploy-tools")?.textContent ?? "";
    expect(text).toContain("1.2.0 → 1.3.0");
    expect(text).toContain("Entra · hooks: PermissionRequest: decide.sh");
    expect(text).toContain("Sai · hooks: PreToolUse: guard.sh");
    await click("Cancelar");
    expect(changes(fake).filter((c) => c.startsWith("plugin update"))).toEqual([]);
    await click("Atualizar deploy-tools");
    await settle(() => (dialog("Atualizar deploy-tools")?.textContent ?? "").includes("→"));
    await click("Atualizar", "button");
    // The fake leaves the old folder in place, so what was left is not what was shown: it is undone.
    await settle(() => (dialog("Atualizar deploy-tools")?.textContent ?? "").includes("removido"));
    expect(dialog("Atualizar deploy-tools")?.textContent).toContain("removido");
    expect(changes(fake).filter((c) => c.startsWith("plugin update"))).toEqual([
      "plugin update deploy-tools@acme --json",
    ]);
    expect(changes(fake).filter((c) => c.startsWith("plugin uninstall"))).toEqual([
      "plugin uninstall deploy-tools@acme --scope user --json",
    ]);
  });

  test("sem mudança no marketplace, o app diz e não oferece atualizar", async () => {
    await open();
    await click("Atualizar deploy-tools");
    await settle(() => (dialog("Atualizar deploy-tools")?.textContent ?? "").includes("Já está"));
    expect(dialog("Atualizar deploy-tools")?.textContent).toContain(
      "Já está na versão do marketplace.",
    );
    expect(
      within(dialog("Atualizar deploy-tools") as HTMLElement).queryByRole("button", {
        name: "Atualizar",
      }),
    ).toBeNull();
  });

  test("fixar a versão marca o plugin e trava o Atualizar; soltar devolve", async () => {
    await open();
    await click("Fixar versão deploy-tools");
    await settle(() => screen.queryByText("Fixado em 1.2.0") !== null);
    expect(screen.queryByText("Fixado em 1.2.0")).not.toBeNull();
    expect(
      (screen.queryByRole("button", { name: "Atualizar deploy-tools" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await click("Soltar versão deploy-tools");
    await settle(() => screen.queryByText("Fixado em 1.2.0") === null);
    expect(screen.queryByText("Fixado em 1.2.0")).toBeNull();
    expect(
      (screen.queryByRole("button", { name: "Atualizar deploy-tools" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  test("Remover pede confirmação, e confirmar desinstala no escopo do plugin, sem --prune nem -y", async () => {
    const { fake } = await open();
    await click("Remover deploy-tools");
    await click("Cancelar");
    expect(changes(fake)).toEqual([]);
    await click("Remover deploy-tools");
    await click("Remover plugin", "button");
    await settle(() => changes(fake).length === 1);
    expect(changes(fake)).toEqual(["plugin uninstall deploy-tools@acme --scope user --json"]);
  });
});

describe("plugins-ui: marketplaces", () => {
  async function marketplaces() {
    const h = await open();
    const tab = screen.queryByRole("tab", { name: "Marketplaces" });
    await act(async () => {
      fireEvent.mouseDown(tab as HTMLElement, { button: 0 });
    });
    await settle(() => screen.queryByRole("button", { name: "Remover marketplace acme" }) !== null);
    return h;
  }

  test("adicionar e remover pedem confirmação; atualizar não", async () => {
    const { fake } = await marketplaces();
    const field = screen.queryByLabelText("Fonte do marketplace");
    expect(field).not.toBeNull();
    await act(async () => {
      fireEvent.change(field as HTMLElement, { target: { value: "acme/novo" } });
    });
    await click("Adicionar marketplace");
    await click("Cancelar");
    expect(changes(fake)).toEqual([]);
    await click("Adicionar marketplace");
    await click("Adicionar", "button");
    await click("Remover marketplace acme");
    await click("Remover", "button");
    await click("Atualizar marketplace acme");
    await settle(() => changes(fake).length === 3);
    expect(changes(fake)).toEqual([
      "plugin marketplace add acme/novo --json",
      "plugin marketplace remove acme --json",
      "plugin marketplace update acme --json",
    ]);
  });
});
