import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync } from "node:fs";
import { join } from "node:path";
import type { FakeCli, FakeRule } from "../../../scripts/test/fake-cli.ts";
import { tempDir } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { MANIFEST, ok, pluginsHost, write } from "./plugins-ui-setup.ts";

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

type Ctx = { installed: string; marketplace: string };

/** The list the fake claude answers: deploy-tools installed, and offered by its marketplace. */
const listing = (ctx: Ctx, more: unknown[] = []) => ({
  args: ["list", "--json"],
  stdout: JSON.stringify({
    installed: [
      {
        id: "deploy-tools@acme",
        version: "1.2.0",
        scope: "user",
        enabled: true,
        installPath: ctx.installed,
      },
      ...more,
    ],
    available: [
      { pluginId: "deploy-tools@acme", name: "deploy-tools", marketplaceName: "acme" },
      { pluginId: "remoto@acme", name: "remoto", marketplaceName: "acme" },
    ],
  }),
});

async function open(extra: (ctx: Ctx) => FakeRule[]) {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await pluginsHost(cleanups, store, fakes, extra);
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: "Plugins" }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: "Plugins" }) as HTMLElement);
  });
  await settle(() => screen.queryByRole("tab", { name: "Disponíveis" }) !== null);
  return { store, ...h };
}

async function click(name: string | RegExp, role = "button") {
  const element = screen.queryByRole(role, { name });
  expect(element).not.toBeNull();
  await act(async () => {
    fireEvent.click(element as HTMLElement);
  });
  await act(() => Bun.sleep(150));
}

async function available() {
  const tab = screen.queryByRole("tab", { name: "Disponíveis" });
  await act(async () => {
    fireEvent.mouseDown(tab as HTMLElement, { button: 0 });
  });
  await settle(() => screen.queryByRole("button", { name: "Instalar deploy-tools" }) !== null);
}

const calls = (fake: FakeCli) => fake.calls().map((c) => c.join(" "));
const installs = (fake: FakeCli) => calls(fake).filter((c) => c.startsWith("plugin install"));
const dialog = (name: string) => screen.queryByRole("dialog", { name });

describe("plugins-ui: instalar", () => {
  test("Instalar mostra o que o plugin traz e o hash; Cancelar não instala nada", async () => {
    const { fake } = await open((ctx) => [
      listing(ctx),
      { args: ["install"], stdout: ok("install") },
    ]);
    await available();
    await click("Instalar deploy-tools");
    await settle(() => dialog("Instalar deploy-tools") !== null);
    const text = dialog("Instalar deploy-tools")?.textContent ?? "";
    expect(text).toContain("PreToolUse (Bash): guard.sh");
    expect(text).toContain("Skills: deploy");
    expect(text).toContain("Hash do conteúdo: ");
    await click("Cancelar");
    expect(installs(fake)).toEqual([]);
    expect(dialog("Instalar deploy-tools")).toBeNull();
  });

  test("confirmar instala pela CLI com o hash mostrado, sem -y, e avisa", async () => {
    const { fake } = await open((ctx) => [
      listing(ctx),
      { args: ["install"], stdout: ok("install") },
    ]);
    await available();
    await click("Instalar deploy-tools");
    await settle(() => dialog("Instalar deploy-tools") !== null);
    await click("Instalar", "button");
    await settle(() => installs(fake).length === 1);
    expect(installs(fake)).toEqual(["plugin install deploy-tools@acme --scope user --json"]);
    expect(installs(fake).join(" ")).not.toMatch(/ -y| --yes/);
    await settle(() => screen.queryByText("Instalado.") !== null);
    expect(screen.queryByText("Instalado.")).not.toBeNull();
  });

  test("um plugin de outro repositório não tem prévia: o app diz e não deixa instalar", async () => {
    const { fake } = await open((ctx) => [
      listing(ctx),
      { args: ["install"], stdout: ok("install") },
    ]);
    await available();
    await click("Instalar remoto");
    await settle(() => dialog("Instalar remoto") !== null);
    expect(dialog("Instalar remoto")?.textContent).toContain(
      "não pode ser mostrado antes de instalar",
    );
    expect(
      within(dialog("Instalar remoto") as HTMLElement).queryByRole("button", { name: "Instalar" }),
    ).toBeNull();
    expect(installs(fake)).toEqual([]);
  });

  test("um comando que o marketplace declara é mostrado, e só 'Aceitar este comando' o aceita, com o sha256 mostrado", async () => {
    const shownCommand = {
      command: "curl https://x.example | sh",
      plugin: "deploy-tools@acme",
      sha256: "a".repeat(64),
    };
    const { fake } = await open((ctx) => [
      listing(ctx),
      { args: ["install", "--accept-command"], stdout: ok("install") },
      {
        args: ["install"],
        code: 1,
        stdout: `${JSON.stringify({ command: "install", outcome: "failed", message: "comando a confirmar", shownCommand })}\n`,
      },
    ]);
    await available();
    await click("Instalar deploy-tools");
    await settle(() => dialog("Instalar deploy-tools") !== null);
    await click("Instalar", "button");
    await settle(() => screen.queryByText("curl https://x.example | sh") !== null);
    expect(screen.queryByText("curl https://x.example | sh")).not.toBeNull();
    expect(installs(fake)).toHaveLength(1);
    await click("Aceitar este comando");
    await settle(() => installs(fake).length === 2);
    expect(installs(fake)[1]).toBe(
      `plugin install deploy-tools@acme --scope user --json --accept-command ${shownCommand.sha256}`,
    );
    expect(installs(fake).join(" ")).not.toMatch(/ -y| --yes/);
  });

  test("uma pasta local mostra a prévia e o resultado do validate; se o validate recusa, não há como instalar", async () => {
    const dir = join(tempDir("fd-local-"), "meu");
    write(dir, {
      ".claude-plugin/plugin.json": MANIFEST.replace("deploy-tools", "meu-local"),
      "skills/x/SKILL.md": "---\nname: x\ndescription: d\n---\nx\n",
    });
    const bad = await open((ctx) => [
      listing(ctx),
      {
        args: ["validate", "--json"],
        code: 1,
        stdout: JSON.stringify({
          success: false,
          manifest: { errors: [{ path: "name", message: "nome inválido" }] },
        }),
      },
    ]);
    const field = screen.queryByLabelText("Pasta de um plugin local");
    expect(field).not.toBeNull();
    await act(async () => {
      fireEvent.change(field as HTMLElement, { target: { value: dir } });
    });
    await click("Prévia da pasta");
    await settle(() => dialog("Instalar meu-local") !== null);
    expect(dialog("Instalar meu-local")?.textContent).toContain("name: nome inválido");
    expect(
      within(dialog("Instalar meu-local") as HTMLElement).queryByRole("button", {
        name: "Instalar",
      }),
    ).toBeNull();
    expect(installs(bad.fake)).toEqual([]);
  });

  test("uma pasta local que passa no validate instala pelo marketplace de diretório", async () => {
    const dir = join(tempDir("fd-local-"), "meu");
    write(dir, {
      ".claude-plugin/plugin.json": MANIFEST.replace("deploy-tools", "meu-local"),
      "skills/x/SKILL.md": "---\nname: x\ndescription: d\n---\nx\n",
    });
    const copy = join(tempDir("fd-installed-"), "meu-local");
    cpSync(dir, copy, { recursive: true });
    const { fake } = await open((ctx) => [
      listing(ctx, [
        { id: "meu-local@dir", version: "1.2.0", scope: "user", enabled: true, installPath: copy },
      ]),
      { args: ["validate", "--json"], stdout: JSON.stringify({ success: true }) },
      { args: ["install"], stdout: ok("install") },
    ]);
    const field = screen.queryByLabelText("Pasta de um plugin local");
    expect(field).not.toBeNull();
    await act(async () => {
      fireEvent.change(field as HTMLElement, { target: { value: dir } });
    });
    await click("Prévia da pasta");
    await settle(() => dialog("Instalar meu-local") !== null);
    await click("Instalar", "button");
    await settle(() => installs(fake).length === 1);
    expect(installs(fake)).toEqual([
      `plugin install meu-local --marketplace ${dir} --scope user --json`,
    ]);
  });
});
