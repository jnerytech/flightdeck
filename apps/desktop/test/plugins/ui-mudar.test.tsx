import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { FakeCli, FakeRule } from "../../../../scripts/test/fake-cli.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle, settleMaybe, uiIdle } from "../wait.ts";
import { ok, pluginsHost, write } from "./ui-setup.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
const fakes: FakeCli[] = [];
afterEach(async () => {
  cleanup();
  // The daemon stops first: a request still in flight must not meet the sentinel `claude`.
  for (const fn of cleanups.splice(0).reverse()) await fn();
  for (const fake of fakes.splice(0)) fake.restore();
});

const RULES = (_ctx: { installed: string; marketplace: string }): FakeRule[] => [
  { args: ["marketplace", "update"], stdout: ok("marketplace-update") },
  { args: ["marketplace", "add"], stdout: ok("marketplace-add") },
  { args: ["marketplace", "remove"], stdout: ok("marketplace-remove") },
  { args: ["update"], stdout: ok("update") },
  { args: ["uninstall"], stdout: ok("uninstall") },
];

/** What the CLI answers when it refuses a change: a non-zero exit and its reason. */
const FAILED = (message: string) =>
  `${JSON.stringify({ command: "x", outcome: "failed", message })}\n`;

async function open(refusals: FakeRule[] = []) {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await pluginsHost(cleanups, store, fakes, (ctx) => [...refusals, ...RULES(ctx)]);
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: "Plugins" }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: "Plugins" }) as HTMLElement);
  });
  await settle(() => screen.queryByRole("button", { name: "Atualizar deploy-tools" }) !== null);
  return { store, ...h };
}

async function click(name: string | RegExp, role = "button") {
  const element = screen.queryByRole(role, { name });
  expect(element).not.toBeNull();
  await act(async () => {
    fireEvent.click(element as HTMLElement);
  });
  await uiIdle();
}

const calls = (fake: FakeCli) => fake.calls().map((c) => c.join(" "));
const changes = (fake: FakeCli) =>
  calls(fake).filter((c) => /^plugin (update|uninstall|marketplace (add|remove|update))/.test(c));
const dialog = (name: string) => screen.queryByRole("dialog", { name });
/** The text of every error notice on the page, as strings: a failed check never prints a DOM node. */
const alerts = () => screen.queryAllByRole("alert").map((node) => node.textContent ?? "");

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
    await settle(() =>
      (dialog("Atualizar deploy-tools")?.textContent ?? "").includes("was removed"),
    );
    expect(dialog("Atualizar deploy-tools")?.textContent).toContain("was removed");
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

describe("plugins-ui: a change the CLI refuses says why (#4490)", () => {
  async function marketplaces(refusals: FakeRule[]) {
    const h = await open(refusals);
    const tab = screen.queryByRole("tab", { name: "Marketplaces" });
    await act(async () => {
      fireEvent.mouseDown(tab as HTMLElement, { button: 0 });
    });
    await settle(() => screen.queryByRole("button", { name: "Remover marketplace acme" }) !== null);
    return h;
  }

  test("a plugin the CLI cannot remove shows the CLI's reason and stays listed", async () => {
    await open([{ args: ["uninstall"], code: 1, stdout: FAILED("o plugin está em uso") }]);
    await click("Remover deploy-tools");
    await click("Remover plugin", "button");
    expect(
      await settleMaybe(() => alerts().some((text) => text.includes("o plugin está em uso"))),
    ).toBe(true);
    expect(alerts()).toEqual(["o plugin está em uso"]);
    expect(screen.queryByRole("button", { name: "Remover deploy-tools" }) !== null).toBe(true);
  });

  test("a marketplace the CLI cannot add shows the CLI's reason and keeps the typed source", async () => {
    await marketplaces([
      { args: ["marketplace", "add"], code: 1, stdout: FAILED("a pasta não existe") },
    ]);
    const field = screen.queryByLabelText("Fonte do marketplace") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(field, { target: { value: "/nao/existe" } });
    });
    await click("Adicionar marketplace");
    await click("Adicionar", "button");
    expect(
      await settleMaybe(() => alerts().some((text) => text.includes("a pasta não existe"))),
    ).toBe(true);
    expect(alerts()).toEqual(["a pasta não existe"]);
    expect(field.value).toBe("/nao/existe");
  });

  test("a marketplace the CLI cannot remove shows the CLI's reason", async () => {
    await marketplaces([
      { args: ["marketplace", "remove"], code: 1, stdout: FAILED("há plugins instalados dele") },
    ]);
    await click("Remover marketplace acme");
    await click("Remover", "button");
    expect(
      await settleMaybe(() => alerts().some((text) => text.includes("há plugins instalados dele"))),
    ).toBe(true);
    expect(alerts()).toEqual(["há plugins instalados dele"]);
    expect(screen.queryByRole("button", { name: "Remover marketplace acme" }) !== null).toBe(true);
  });

  test("a marketplace the CLI cannot update shows the CLI's reason, and the next action clears it", async () => {
    await marketplaces([{ args: ["marketplace", "update"], code: 1, stdout: FAILED("sem rede") }]);
    await click("Atualizar marketplace acme");
    expect(await settleMaybe(() => alerts().some((text) => text.includes("sem rede")))).toBe(true);
    expect(alerts()).toEqual(["sem rede"]);
    await click("Remover marketplace acme");
    await click("Remover", "button");
    expect(await settleMaybe(() => alerts().length === 0)).toBe(true);
    expect(alerts()).toEqual([]);
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

  /** The page's add flow over a slice that answers the proof the way the test says (#3516). */
  async function addWith(
    answer: () => Promise<unknown>,
    spy?: (type: string, payload: unknown) => void,
  ) {
    const h = await marketplaces();
    const messages: string[] = [];
    h.store.reportError = (message: string) => {
      messages.push(message);
    };
    (h.store.approval as unknown as Record<string, unknown>).marketplaceAddPayload = answer;
    if (spy) {
      const real = h.store.hostCommand.bind(h.store);
      (h.store as unknown as Record<string, unknown>).hostCommand = async (
        ...args: Parameters<typeof real>
      ) => {
        spy(args[1], args[2]);
        return await real(...args);
      };
    }
    const field = screen.queryByLabelText("Fonte do marketplace") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(field, { target: { value: "acme/novo" } });
    });
    await click("Adicionar marketplace");
    await click("Adicionar", "button");
    await uiIdle();
    return { ...h, messages, field };
  }

  test("a no in the device dialog adds nothing and leaves the typed source", async () => {
    const { fake, messages, field } = await addWith(async () => ({ kind: "declined" }));
    expect([changes(fake), messages, field.value]).toEqual([[], [], "acme/novo"]);
  });

  test("a source the device cannot show is reported with the forms it can show, and stays typed", async () => {
    const { fake, messages, field } = await addWith(async () => {
      throw new Error("the marketplace source is not one the dialog can show");
    });
    expect(changes(fake)).toEqual([]);
    expect(field.value).toBe("acme/novo");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("the marketplace source is not one the dialog can show");
    expect(messages[0]).toContain("dono/repo");
  });

  test("a failure that is not the source is reported as it came, without the source forms", async () => {
    const { fake, messages, field } = await addWith(async () => {
      throw new Error("the host did not answer the challenge");
    });
    expect([changes(fake), messages, field.value]).toEqual([
      [],
      ["the host did not answer the challenge"],
      "acme/novo",
    ]);
  });

  test("the signed source goes to the host with its proof, and the field is cleared", async () => {
    const proof = { keyId: "k", nonce: "n", signature: "s" };
    const sent: unknown[] = [];
    const { field } = await addWith(
      async () => ({
        kind: "payload",
        payload: { source: "acme/novo", confirm: true, proof },
      }),
      (type, payload) => {
        if (type === "plugins.marketplaceAdd") sent.push(payload);
      },
    );
    expect([sent, field.value]).toEqual([[{ source: "acme/novo", confirm: true, proof }], ""]);
  });
});
