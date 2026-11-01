import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync } from "node:fs";
import { join } from "node:path";
import type { FakeCli, FakeRule } from "../../../scripts/test/fake-cli.ts";
import { tempDir } from "../../daemon/test/helpers.ts";
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
  // The daemon stops first: a request still in flight must not meet the sentinel `claude`.
  for (const fn of cleanups.splice(0).reverse()) await fn();
  for (const fake of fakes.splice(0)) fake.restore();
});

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(15));
}

type Ctx = { installed: string; marketplace: string };

async function open(extra: (ctx: Ctx) => FakeRule[], before: (ctx: Ctx) => void = () => {}) {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await pluginsHost(cleanups, store, fakes, extra);
  before(h);
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: "Plugins" }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: "Plugins" }) as HTMLElement);
  });
  await settle(() => screen.queryByRole("tab", { name: "Disponíveis" }) !== null);
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

async function tab(name: string) {
  await settle(() => screen.queryByRole("tab", { name }) !== null);
  await act(async () => {
    fireEvent.mouseDown(screen.queryByRole("tab", { name }) as HTMLElement, { button: 0 });
  });
}

const calls = (fake: FakeCli) => fake.calls().map((c) => c.join(" "));
const dialog = (name: string) => screen.queryByRole("dialog", { name });
const FAILED = (message: string, extra: Record<string, unknown> = {}) =>
  `${JSON.stringify({ command: "x", outcome: "failed", message, ...extra })}\n`;

const broken = (ctx: Ctx) => ({
  args: ["list", "--json", "--available"],
  stdout: JSON.stringify({
    installed: [
      {
        id: "deploy-tools@acme",
        version: "1.2.0",
        scope: "user",
        enabled: true,
        installPath: ctx.installed,
      },
      {
        id: "quebrado@acme",
        version: "0.0.1",
        scope: "managed",
        enabled: false,
        installPath: "/nao/existe",
        errors: ["falhou ao carregar"],
      },
    ],
    available: [{ pluginId: "outro@acme", name: "outro", marketplaceName: "acme" }],
  }),
});

describe("plugins-ui: casos de borda", () => {
  test("um plugin que não carregou mostra os erros, não tem inventário, e sai sem escopo quando o escopo não é de instalação", async () => {
    const { fake } = await open((ctx) => [
      broken(ctx),
      { args: ["uninstall"], stdout: ok("uninstall") },
    ]);
    await settle(() => screen.queryByText("falhou ao carregar") !== null);
    expect(screen.queryByText("falhou ao carregar")).not.toBeNull();
    await click("Ver o que instala quebrado");
    await settle(() => screen.queryByText("A pasta do plugin não pôde ser lida.") !== null);
    expect(screen.queryByText("A pasta do plugin não pôde ser lida.")).not.toBeNull();
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    await act(() => Bun.sleep(100));
    await click("Remover quebrado");
    await click("Remover plugin", "button");
    await settle(() => calls(fake).some((c) => c.startsWith("plugin uninstall")));
    expect(calls(fake).filter((c) => c.startsWith("plugin uninstall"))).toEqual([
      "plugin uninstall quebrado@acme --json",
    ]);
  });

  test("a prévia mostra monitores, agentes, comandos, servidores MCP e o que o app não pôde ler", async () => {
    await open(
      (ctx) => [broken(ctx)],
      ({ marketplace }) =>
        write(join(marketplace, "plugins/outro"), {
          ".claude-plugin/plugin.json": JSON.stringify({
            name: "outro",
            version: "0.1.0",
            hooks: "../../fora.json",
          }),
          "monitors/monitors.json": JSON.stringify([
            { name: "estado", command: "poll.sh", description: "d" },
          ]),
          "agents/revisor.md": "---\nname: revisor\ndescription: d\n---\nx\n",
        }),
    );
    await tab("Disponíveis");
    await settle(() => screen.queryByRole("button", { name: "Instalar outro" }) !== null);
    await click("Instalar outro");
    await settle(() => (dialog("Instalar outro")?.textContent ?? "").includes("Hash do conteúdo"));
    const text = dialog("Instalar outro")?.textContent ?? "";
    expect(text).toContain("estado: poll.sh");
    expect(text).toContain("Agentes: revisor");
    expect(text).toContain("Comandos: ola");
    expect(text).toContain("Servidores MCP: api (stdio: node s.js)");
    expect(text).toContain("hooks: caminho fora do plugin: ../../fora.json");
  });

  test("sem marketplace configurado a aba diz isso", async () => {
    await open((ctx) => [{ args: ["marketplace", "list"], stdout: "[]" }, broken(ctx)]);
    await tab("Marketplaces");
    await settle(() => screen.queryByText("Nenhum marketplace configurado.") !== null);
    expect(screen.queryByText("Nenhum marketplace configurado.")).not.toBeNull();
  });

  test("uma instalação que a CLI recusa mostra o motivo no diálogo", async () => {
    await open((ctx) => [
      {
        args: ["list", "--json", "--available"],
        stdout: JSON.stringify({
          installed: [
            {
              id: "deploy-tools@acme",
              version: "1.2.0",
              scope: "user",
              enabled: true,
              installPath: ctx.installed,
            },
          ],
          available: [
            { pluginId: "deploy-tools@acme", name: "deploy-tools", marketplaceName: "acme" },
          ],
        }),
      },
      { args: ["install"], code: 1, stdout: FAILED("o marketplace recusou") },
    ]);
    await tab("Disponíveis");
    await settle(() => screen.queryByRole("button", { name: "Instalar deploy-tools" }) !== null);
    await click("Instalar deploy-tools");
    await settle(() =>
      (dialog("Instalar deploy-tools")?.textContent ?? "").includes("Hash do conteúdo"),
    );
    await click("Instalar", "button");
    await settle(() =>
      (dialog("Instalar deploy-tools")?.textContent ?? "").includes("o marketplace recusou"),
    );
    expect(dialog("Instalar deploy-tools")?.textContent).toContain("o marketplace recusou");
  });
});

describe("plugins-ui: atualização, casos de borda", () => {
  const withNewSource = ({ marketplace }: Ctx) =>
    write(join(marketplace, "plugins/deploy-tools"), {
      ".claude-plugin/plugin.json": JSON.stringify({ name: "deploy-tools", version: "1.3.0" }),
    });
  const base = (ctx: Ctx): FakeRule[] => [
    { args: ["marketplace", "update"], stdout: ok("marketplace-update") },
    broken(ctx),
  ];

  async function openUpdate(extra: (ctx: Ctx) => FakeRule[]) {
    const h = await open(
      (ctx) => [...base(ctx).slice(0, 1), ...extra(ctx), ...base(ctx).slice(1)],
      withNewSource,
    );
    await settle(() => screen.queryByRole("button", { name: "Atualizar deploy-tools" }) !== null);
    await click("Atualizar deploy-tools");
    await settle(() => (dialog("Atualizar deploy-tools")?.textContent ?? "").includes("→"));
    return h;
  }

  test("uma atualização que a CLI recusa mostra o motivo", async () => {
    await openUpdate(() => [{ args: ["update"], code: 1, stdout: FAILED("sem rede") }]);
    await click("Atualizar", "button");
    await settle(() => (dialog("Atualizar deploy-tools")?.textContent ?? "").includes("sem rede"));
    expect(dialog("Atualizar deploy-tools")?.textContent).toContain("sem rede");
  });

  test("um comando que o marketplace declara na atualização é mostrado e só o sha256 dele o aceita", async () => {
    const shownCommand = {
      command: "curl https://y.example | sh",
      plugin: "deploy-tools@acme",
      sha256: "b".repeat(64),
    };
    const { fake } = await openUpdate(() => [
      { args: ["update", "--accept-command"], stdout: FAILED("ainda recusa") },
      { args: ["update"], code: 1, stdout: FAILED("comando a confirmar", { shownCommand }) },
    ]);
    await click("Atualizar", "button");
    await settle(() => screen.queryByText("curl https://y.example | sh") !== null);
    await click("Aceitar este comando");
    await settle(() => calls(fake).some((c) => c.includes("--accept-command")));
    expect(calls(fake).filter((c) => c.startsWith("plugin update"))).toEqual([
      "plugin update deploy-tools@acme --json",
      `plugin update deploy-tools@acme --json --accept-command ${"b".repeat(64)}`,
    ]);
  });

  test("uma atualização que fica como foi mostrada avisa e fecha", async () => {
    const copy = join(tempDir("fd-new-"), "deploy-tools");
    const { fake } = await open(
      (ctx) => [
        { args: ["marketplace", "update"], stdout: ok("marketplace-update") },
        { args: ["update"], stdout: ok("update") },
        // The 12th call is the check after the update (the page itself listed first): by then the folder holds the new content.
        {
          args: ["list", "--json", "--available"],
          call: 12,
          stdout: JSON.stringify({
            installed: [
              {
                id: "deploy-tools@acme",
                version: "1.3.0",
                scope: "user",
                enabled: true,
                installPath: copy,
              },
            ],
            available: [],
          }),
        },
        ...base(ctx),
      ],
      (ctx) => {
        withNewSource(ctx);
        cpSync(join(ctx.marketplace, "plugins/deploy-tools"), copy, { recursive: true });
      },
    );
    await click("Atualizar deploy-tools");
    await settle(() => (dialog("Atualizar deploy-tools")?.textContent ?? "").includes("→"));
    await click("Atualizar", "button");
    await settle(() => screen.queryByText("Atualizado.") !== null);
    expect(screen.queryByText("Atualizado.")).not.toBeNull();
    expect(dialog("Atualizar deploy-tools")).toBeNull();
    expect(calls(fake).filter((c) => c.startsWith("plugin uninstall"))).toEqual([]);
  });

  test("quando a nova versão não pode ser mostrada, o app diz", async () => {
    await open((ctx) => [
      { args: ["marketplace", "update"], stdout: ok("marketplace-update") },
      {
        args: ["list", "--json", "--available"],
        stdout: JSON.stringify({
          installed: [
            {
              id: "remoto@acme",
              version: "1",
              scope: "user",
              enabled: true,
              installPath: ctx.installed,
            },
          ],
          available: [],
        }),
      },
    ]);
    await settle(() => screen.queryByRole("button", { name: "Atualizar remoto" }) !== null);
    await click("Atualizar remoto");
    await settle(
      () => screen.queryByText("O conteúdo da nova versão não pôde ser mostrado.") !== null,
    );
    expect(screen.queryByText("O conteúdo da nova versão não pôde ser mostrado.")).not.toBeNull();
  });
});

describe("plugins-ui: fechar com Esc", () => {
  const pressEsc = async () => {
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    await act(() => Bun.sleep(100));
  };

  test("Esc fecha o diálogo de instalar e o de atualizar sem fazer nada", async () => {
    const { fake } = await open(
      (ctx) => [
        { args: ["marketplace", "update"], stdout: ok("marketplace-update") },
        {
          args: ["list", "--json", "--available"],
          stdout: JSON.stringify({
            installed: [
              {
                id: "deploy-tools@acme",
                version: "1.2.0",
                scope: "user",
                enabled: true,
                installPath: ctx.installed,
              },
            ],
            available: [{ pluginId: "outro@acme", name: "outro", marketplaceName: "acme" }],
          }),
        },
      ],
      ({ marketplace }) =>
        write(join(marketplace, "plugins/deploy-tools"), {
          ".claude-plugin/plugin.json": JSON.stringify({ name: "deploy-tools", version: "1.3.0" }),
        }),
    );
    await click("Atualizar deploy-tools");
    await settle(() => dialog("Atualizar deploy-tools") !== null);
    await pressEsc();
    expect(dialog("Atualizar deploy-tools")).toBeNull();
    await tab("Disponíveis");
    await settle(() => screen.queryByRole("button", { name: "Instalar outro" }) !== null);
    await click("Instalar outro");
    await settle(() => dialog("Instalar outro") !== null);
    await pressEsc();
    expect(dialog("Instalar outro")).toBeNull();
    expect(calls(fake).filter((c) => /^plugin (install|update|uninstall)/.test(c))).toEqual([]);
  });
});
