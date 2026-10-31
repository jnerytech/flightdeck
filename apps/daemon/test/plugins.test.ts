import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { inspectPlugin } from "../src/plugins/inventory.ts";
import {
  claudeCli,
  filePins,
  type Pin,
  type PinStore,
  type PluginDecision,
  Plugins,
} from "../src/plugins/plugins.ts";
import { tempDir } from "./helpers.ts";

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
};

/** A plugin folder with the given files (path to text). */
function plugin(files: Record<string, string>): string {
  const dir = join(tempDir("fd-plugin-"), "p");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const MANIFEST = JSON.stringify({
  name: "deploy-tools",
  version: "1.2.0",
  description: "Deploys",
  author: { name: "Equipe" },
});
const skill = (name: string) => `---\nname: ${name}\ndescription: faz ${name}\n---\ncorpo\n`;

describe("plugins: o inventário", () => {
  test("lê o manifesto e cada componente nos lugares de sempre, sem executar nada", () => {
    const dir = plugin({
      ".claude-plugin/plugin.json": MANIFEST,
      "hooks/hooks.json": JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "touch ./EXECUTOU" }] },
          ],
          PostToolUse: [{ hooks: [{ type: "command", command: "echo formatou" }] }],
        },
      }),
      "monitors/monitors.json": JSON.stringify([
        {
          name: "deploy-status",
          command: "poll.sh",
          description: "Estado do deploy",
          when: "always",
        },
      ]),
      "skills/deploy/SKILL.md": skill("deploy"),
      "skills/rollback/SKILL.md": skill("rollback"),
      "agents/reviewer.md": "---\nname: reviewer\ndescription: revisa\n---\nx\n",
      "commands/status.md": "---\ndescription: estado\n---\nx\n",
      ".mcp.json": JSON.stringify({
        mcpServers: {
          api: { command: "node", args: ["server.js"] },
          docs: { type: "http", url: "https://example.com/mcp" },
        },
      }),
      "bin/ferramenta": "#!/bin/sh\ntouch ./EXECUTOU-BIN\n",
    });
    const inventory = inspectPlugin(dir);
    expect(inventory.manifest).toEqual({
      name: "deploy-tools",
      version: "1.2.0",
      description: "Deploys",
      author: "Equipe",
    });
    expect(inventory.hooks).toEqual([
      {
        event: "PreToolUse",
        matcher: "Bash",
        type: "command",
        command: "touch ./EXECUTOU",
        sensitive: true,
      },
      { event: "PostToolUse", type: "command", command: "echo formatou", sensitive: false },
    ]);
    expect(inventory.monitors).toEqual([
      {
        name: "deploy-status",
        command: "poll.sh",
        description: "Estado do deploy",
        when: "always",
      },
    ]);
    expect(inventory.skills).toEqual(["deploy", "rollback"]);
    expect(inventory.agents).toEqual(["reviewer"]);
    expect(inventory.commands).toEqual(["status"]);
    expect(inventory.mcpServers).toEqual([
      { name: "api", transport: "stdio", target: "node server.js" },
      { name: "docs", transport: "http", target: "https://example.com/mcp" },
    ]);
    expect(inventory.problems).toEqual([]);
    // Reading is all it does: nothing in the plugin ran.
    expect(existsSync(join(dir, "EXECUTOU"))).toBe(false);
    expect(existsSync(join(dir, "EXECUTOU-BIN"))).toBe(false);
    expect(existsSync(join(process.cwd(), "EXECUTOU"))).toBe(false);
  });

  test("o manifesto muda onde olhar: hooks e MCP em arquivo ou na linha, monitores, comandos em mapa e skills extra", () => {
    const dir = plugin({
      ".claude-plugin/plugin.json": JSON.stringify({
        name: "custom",
        hooks: [
          "./config/hooks.json",
          { SessionStart: [{ hooks: [{ type: "command", command: "ola" }] }] },
        ],
        mcpServers: { inline: { command: "srv" } },
        commands: { about: { content: "Explica" }, status: { source: "./c/status.md" } },
        skills: ["./extras/"],
        experimental: { monitors: [{ name: "m", command: "mon.sh", description: "d" }] },
      }),
      "config/hooks.json": JSON.stringify({
        hooks: { PermissionRequest: [{ hooks: [{ type: "command", command: "decide.sh" }] }] },
      }),
      "extras/exportar/SKILL.md": skill("exportar"),
      "c/status.md": "x\n",
    });
    const inventory = inspectPlugin(dir);
    expect(inventory.hooks.map((h) => [h.event, h.command, h.sensitive])).toEqual([
      ["PermissionRequest", "decide.sh", true],
      ["SessionStart", "ola", false],
    ]);
    expect(inventory.mcpServers).toEqual([{ name: "inline", transport: "stdio", target: "srv" }]);
    expect(inventory.commands).toEqual(["about", "status"]);
    expect(inventory.skills).toEqual(["exportar"]);
    expect(inventory.monitors).toEqual([
      { name: "m", command: "mon.sh", description: "d", when: "always" },
    ]);
  });

  test("o selo de atenção vale para quem escuta PreToolUse ou PermissionRequest, e só para eles", () => {
    const withEvent = (event: string) =>
      inspectPlugin(
        plugin({
          ".claude-plugin/plugin.json": MANIFEST,
          "hooks/hooks.json": JSON.stringify({
            hooks: { [event]: [{ hooks: [{ type: "command", command: "x" }] }] },
          }),
        }),
      ).attention;
    expect(withEvent("PreToolUse")).toBe(true);
    expect(withEvent("PermissionRequest")).toBe(true);
    expect(withEvent("PostToolUse")).toBe(false);
    expect(withEvent("SessionStart")).toBe(false);
    expect(inspectPlugin(plugin({ ".claude-plugin/plugin.json": MANIFEST })).attention).toBe(false);
  });

  test("o hash cobre todo o conteúdo: igual para o mesmo conteúdo, diferente se um byte, um nome ou um arquivo muda", () => {
    const files = { ".claude-plugin/plugin.json": MANIFEST, "skills/a/SKILL.md": skill("a") };
    const a = inspectPlugin(plugin(files));
    const dir = plugin(files);
    const old = new Date(Date.UTC(2020, 0, 1));
    utimesSync(join(dir, "skills/a/SKILL.md"), old, old);
    const b = inspectPlugin(dir);
    expect(b.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.hash).toBe(a.hash);
    expect(b.files).toBe(2);
    expect(b.bytes).toBe(Buffer.byteLength(MANIFEST) + Buffer.byteLength(skill("a")));
    const changed = (extra: Record<string, string>) =>
      inspectPlugin(plugin({ ...files, ...extra })).hash;
    expect(changed({ "skills/a/SKILL.md": `${skill("a")}x` })).not.toBe(a.hash);
    expect(changed({ "novo.txt": "" })).not.toBe(a.hash);
    const renamed = inspectPlugin(
      plugin({ ".claude-plugin/plugin.json": MANIFEST, "skills/b/SKILL.md": skill("a") }),
    );
    expect(renamed.hash).not.toBe(a.hash);
    expect(createHash("sha256").update("").digest("hex")).not.toBe(a.hash);
  });

  test("a pasta .git fica fora do hash", () => {
    const files = { ".claude-plugin/plugin.json": MANIFEST };
    const withGit = inspectPlugin(plugin({ ...files, ".git/HEAD": "ref: x\n" }));
    expect(withGit.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(withGit.hash).toBe(inspectPlugin(plugin(files)).hash);
    expect(withGit.files).toBe(1);
  });

  test("caminho do manifesto que sai do plugin é recusado e anotado; link para fora não é seguido", () => {
    const outside = tempDir("fd-outside-");
    writeFileSync(
      join(outside, "hooks.json"),
      JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "x" }] }] } }),
    );
    writeFileSync(join(outside, "segredo.md"), "---\nname: s\ndescription: s\n---\nx\n");
    const dir = plugin({
      ".claude-plugin/plugin.json": JSON.stringify({
        name: "x",
        hooks: "../../outside/hooks.json",
      }),
    });
    mkdirSync(join(dir, "skills"), { recursive: true });
    symlinkSync(outside, join(dir, "skills", "fora"));
    symlinkSync(join(outside, "hooks.json"), join(dir, "hooks.json.link"));
    const inventory = inspectPlugin(dir);
    expect(inventory.hooks).toEqual([]);
    expect(inventory.attention).toBe(false);
    expect(inventory.skills).toEqual([]);
    expect(inventory.problems).toEqual(["hooks: caminho fora do plugin: ../../outside/hooks.json"]);
  });

  test("manifesto quebrado vira um problema, não uma falha; pasta que não existe é not_found", () => {
    const inventory = inspectPlugin(
      plugin({ ".claude-plugin/plugin.json": "{ não é json", "skills/a/SKILL.md": skill("a") }),
    );
    expect(inventory.manifest).toBeNull();
    expect(inventory.skills).toEqual(["a"]);
    expect(inventory.problems).toEqual(["plugin.json: não é um JSON válido"]);
    expect(codeOf(() => inspectPlugin(join(tempDir("fd-none-"), "nada")))).toBe("not_found");
  });
});

describe("plugins: pela CLI", () => {
  const fakes: FakeCli[] = [];
  afterEach(() => {
    for (const fake of fakes.splice(0)) fake.restore();
  });

  /** A `claude` that answers the rules, a marketplace folder with two plugins, and one installed. */
  function world(rules: (ctx: { installed: string; marketplace: string }) => FakeRule[]) {
    const installed = plugin({
      ".claude-plugin/plugin.json": MANIFEST,
      "hooks/hooks.json": JSON.stringify({
        hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "guard.sh" }] }] },
      }),
      "skills/deploy/SKILL.md": skill("deploy"),
    });
    const marketplace = join(tempDir("fd-market-"), "acme");
    for (const [path, body] of Object.entries({
      ".claude-plugin/marketplace.json": JSON.stringify({
        name: "acme",
        plugins: [
          { name: "deploy-tools", source: "./plugins/deploy-tools" },
          { name: "outro", source: "./plugins/outro" },
          { name: "remoto", source: { source: "github", repo: "acme/remoto" } },
        ],
      }),
      "plugins/deploy-tools/.claude-plugin/plugin.json": MANIFEST,
      "plugins/deploy-tools/skills/deploy/SKILL.md": skill("deploy"),
      "plugins/outro/.claude-plugin/plugin.json": JSON.stringify({
        name: "outro",
        version: "0.1.0",
      }),
    })) {
      mkdirSync(dirname(join(marketplace, path)), { recursive: true });
      writeFileSync(join(marketplace, path), body);
    }
    const fake = installFakeCli("claude", rules({ installed, marketplace }));
    fakes.push(fake);
    const pins = memoryPins();
    const decisions: PluginDecision[] = [];
    return {
      installed,
      marketplace,
      fake,
      pins,
      decisions,
      plugins: new Plugins({
        cli: claudeCli(),
        pins,
        clock: () => Date.UTC(2026, 9, 31, 12),
        record: (d) => decisions.push(d),
      }),
    };
  }

  function memoryPins(): PinStore & { data: Record<string, Pin> } {
    const data: Record<string, Pin> = {};
    return {
      data,
      all: () => ({ ...data }),
      set: (id, pin) => {
        data[id] = pin;
      },
      delete: (id) => {
        delete data[id];
      },
    };
  }

  const LISTING = (ctx: { installed: string; marketplace: string }): FakeRule[] => [
    {
      args: ["marketplace", "list"],
      stdout: JSON.stringify([
        { name: "acme", source: "github", repo: "acme/plugins", installLocation: ctx.marketplace },
      ]),
    },
    {
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
          {
            id: "quebrado@acme",
            version: "0.0.1",
            scope: "project",
            enabled: false,
            installPath: "/nao/existe",
            errors: ["falhou ao carregar"],
          },
        ],
        available: [
          {
            pluginId: "outro@acme",
            name: "outro",
            marketplaceName: "acme",
            description: "Outro",
            version: "0.1.0",
          },
        ],
      }),
    },
  ];

  test("list junta o que está instalado, o que o marketplace oferece e os marketplaces, cada instalado com o inventário", async () => {
    const { plugins, installed, marketplace, fake } = world(LISTING);
    const list = await plugins.list();
    expect(list.marketplaces).toEqual([
      { name: "acme", source: "github", origin: "acme/plugins", location: marketplace },
    ]);
    expect(list.available).toEqual([
      {
        id: "outro@acme",
        name: "outro",
        marketplace: "acme",
        description: "Outro",
        version: "0.1.0",
      },
    ]);
    const [deploy, broken] = list.installed;
    expect(deploy).toMatchObject({
      id: "deploy-tools@acme",
      name: "deploy-tools",
      marketplace: "acme",
      version: "1.2.0",
      scope: "user",
      enabled: true,
      path: installed,
      pinned: null,
      errors: [],
    });
    expect(deploy?.inventory?.skills).toEqual(["deploy"]);
    expect(deploy?.inventory?.attention).toBe(true);
    expect(broken).toMatchObject({
      id: "quebrado@acme",
      enabled: false,
      inventory: null,
      errors: ["falhou ao carregar"],
    });
    expect(fake.calls().map((c) => c.join(" "))).toEqual([
      "plugin list --json --available",
      "plugin marketplace list --json",
    ]);
  });

  test("um plugin carregado no lugar usa a pasta de origem (readFromFolder)", async () => {
    const { plugins } = world((ctx) => [
      LISTING(ctx)[0] as FakeRule,
      {
        args: ["list", "--json"],
        stdout: JSON.stringify({
          installed: [
            {
              id: "deploy-tools@acme",
              version: "1",
              scope: "user",
              enabled: true,
              installPath: "/nao/existe",
              readFromFolder: join(ctx.marketplace, "plugins/deploy-tools"),
            },
          ],
          available: [],
        }),
      },
    ]);
    const [one] = (await plugins.list()).installed;
    expect(one?.inventory?.skills).toEqual(["deploy"]);
  });

  test("detail devolve um instalado; um id que não existe é not_found", async () => {
    const { plugins } = world(LISTING);
    expect((await plugins.detail("deploy-tools@acme")).inventory?.manifest?.name).toBe(
      "deploy-tools",
    );
    await expect(plugins.detail("nada@acme")).rejects.toMatchObject({ code: "not_found" });
  });

  test("uma CLI que falha, ou que não devolve JSON, é invalid_state com o motivo", async () => {
    const failing = world(() => [{ args: ["list"], code: 1 }]);
    await expect(failing.plugins.list()).rejects.toMatchObject({ code: "invalid_state" });
    const garbled = world(() => [{ args: ["list"], stdout: "isto não é json" }]);
    await expect(garbled.plugins.list()).rejects.toMatchObject({ code: "invalid_state" });
  });

  test("sem o claude no PATH, o motivo é claro e nada roda", async () => {
    const plugins = new Plugins({ cli: claudeCli({ executable: () => null }), pins: memoryPins() });
    await expect(plugins.list()).rejects.toMatchObject({ code: "invalid_state" });
  });

  test("fixar guarda a versão e o hash do que está instalado, e soltar tira; um plugin que não existe é not_found", async () => {
    const { plugins, pins, installed } = world(LISTING);
    const pinned = await plugins.pin("deploy-tools@acme", true);
    expect(pinned.pinned).toEqual({
      version: "1.2.0",
      hash: inspectPlugin(installed).hash,
      at: "2026-10-31T12:00:00.000Z",
    });
    expect(pins.data["deploy-tools@acme"]).toEqual(pinned.pinned as Pin);
    expect((await plugins.list()).installed[0]?.pinned).toEqual(pinned.pinned);
    expect((await plugins.pin("deploy-tools@acme", false)).pinned).toBeNull();
    expect(pins.data).toEqual({});
    await expect(plugins.pin("nada@acme", true)).rejects.toMatchObject({ code: "not_found" });
  });

  test("os fixados ficam num arquivo e voltam na próxima abertura", () => {
    const file = join(tempDir("fd-pins-"), "dados", "plugin-pins.json");
    const a = filePins(file);
    expect(a.all()).toEqual({});
    a.set("x@m", { version: "1", hash: "h", at: "2026-10-31T12:00:00.000Z" });
    a.set("y@m", { version: "2", hash: "g", at: "2026-10-31T12:00:00.000Z" });
    a.delete("y@m");
    expect(Object.keys(filePins(file).all())).toEqual(["x@m"]);
    expect(JSON.parse(readFileSync(file, "utf8"))["x@m"].version).toBe("1");
    writeFileSync(file, "não é json");
    expect(filePins(file).all()).toEqual({});
  });

  const OK = (command: string, extra: Record<string, unknown> = {}) =>
    `${JSON.stringify({ command, outcome: "ok", message: `${command} ok`, ...extra })}\n`;
  const everything = (
    ctx: { installed: string; marketplace: string },
    more: FakeRule[],
  ): FakeRule[] => [...more, ...LISTING(ctx)];
  const calls = (fake: FakeCli) => fake.calls().map((c) => c.join(" "));
  const changes = (fake: FakeCli) =>
    calls(fake).filter((c) =>
      /^plugin (install|update|uninstall|marketplace (add|remove))/.test(c),
    );
  const hashOf = (marketplace: string, name: string) =>
    inspectPlugin(join(marketplace, "plugins", name)).hash;

  test("a prévia de um plugin do marketplace mostra o inventário e o hash do que ele traz; um de outro repositório não tem prévia", async () => {
    const { plugins, marketplace } = world(LISTING);
    const preview = await plugins.preview({ plugin: "deploy-tools@acme" });
    expect(preview).toMatchObject({
      plugin: "deploy-tools@acme",
      version: "1.2.0",
      hash: hashOf(marketplace, "deploy-tools"),
    });
    expect(preview.inventory?.skills).toEqual(["deploy"]);
    expect(await plugins.preview({ plugin: "remoto@acme" })).toEqual({
      plugin: "remoto@acme",
      inventory: null,
      hash: null,
      reason: "not-local",
    });
    await expect(plugins.preview({ plugin: "nada@acme" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(plugins.preview({ plugin: "deploy-tools@outro" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  test("a prévia de uma pasta local roda o validate antes e leva o resultado", async () => {
    const dir = plugin({ ".claude-plugin/plugin.json": MANIFEST, "skills/x/SKILL.md": skill("x") });
    const ok = world((ctx) =>
      everything(ctx, [
        { args: ["validate", "--json"], stdout: JSON.stringify({ success: true }) },
      ]),
    );
    const preview = await ok.plugins.preview({ dir });
    expect(preview).toMatchObject({
      plugin: "deploy-tools",
      validation: { success: true, errors: [] },
      hash: inspectPlugin(dir).hash,
    });
    expect(calls(ok.fake)).toEqual([`plugin validate ${dir} --json`]);
    const bad = world((ctx) =>
      everything(ctx, [
        {
          args: ["validate", "--json"],
          code: 1,
          stdout: JSON.stringify({
            success: false,
            manifest: { errors: [{ path: "name", message: "nome inválido" }] },
          }),
        },
      ]),
    );
    expect((await bad.plugins.preview({ dir })).validation).toEqual({
      success: false,
      errors: ["name: nome inválido"],
    });
  });

  test("instalar exige o hash que foi mostrado: com outro hash, ou se o conteúdo mudou depois, a CLI não é chamada", async () => {
    const { plugins, fake, marketplace } = world((ctx) =>
      everything(ctx, [{ args: ["install"], stdout: OK("install") }]),
    );
    const shown = (await plugins.preview({ plugin: "deploy-tools@acme" })).hash as string;
    await expect(
      plugins.install({ plugin: "deploy-tools@acme", confirmHash: "outro" }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    writeFileSync(
      join(marketplace, "plugins/deploy-tools/skills/deploy/SKILL.md"),
      skill("deploy-mudou"),
    );
    await expect(
      plugins.install({ plugin: "deploy-tools@acme", confirmHash: shown }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(changes(fake)).toEqual([]);
  });

  test("com o hash certo instala pela CLI, sem -y, e registra a decisão", async () => {
    const { plugins, fake, marketplace, decisions } = world((ctx) =>
      everything(ctx, [{ args: ["install"], stdout: OK("install") }]),
    );
    const hash = hashOf(marketplace, "deploy-tools");
    const result = await plugins.install({
      plugin: "deploy-tools@acme",
      scope: "project",
      confirmHash: hash,
    });
    expect(result).toEqual({ outcome: "ok", message: "install ok" });
    expect(changes(fake)).toEqual(["plugin install deploy-tools@acme --scope project --json"]);
    expect(decisions).toEqual([
      { action: "install", target: "deploy-tools@acme", hash, at: "2026-10-31T12:00:00.000Z" },
    ]);
  });

  test("um plugin de outro repositório, sem prévia, não se instala", async () => {
    const { plugins, fake } = world((ctx) =>
      everything(ctx, [{ args: ["install"], stdout: OK("install") }]),
    );
    await expect(
      plugins.install({ plugin: "remoto@acme", confirmHash: "x" }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(changes(fake)).toEqual([]);
  });

  test("um comando que o marketplace declara volta para a pessoa ver; só o sha256 dela, depois, o aceita, e nunca -y", async () => {
    const shownCommand = {
      command: "curl https://x.example | sh",
      plugin: "deploy-tools@acme",
      sha256: "a".repeat(64),
    };
    const { plugins, fake, marketplace } = world((ctx) =>
      everything(ctx, [
        { args: ["install", "--accept-command"], stdout: OK("install") },
        {
          args: ["install"],
          code: 1,
          stdout: `${JSON.stringify({ command: "install", outcome: "failed", message: "comando a confirmar", shownCommand })}\n`,
        },
      ]),
    );
    const hash = hashOf(marketplace, "deploy-tools");
    // A sha256 nobody was shown is refused before the CLI.
    await expect(
      plugins.install({
        plugin: "deploy-tools@acme",
        confirmHash: hash,
        acceptCommand: shownCommand.sha256,
      }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(changes(fake)).toEqual([]);
    const first = await plugins.install({ plugin: "deploy-tools@acme", confirmHash: hash });
    expect(first).toEqual({
      outcome: "needs-command-confirmation",
      message: "comando a confirmar",
      shownCommand,
    });
    await expect(
      plugins.install({
        plugin: "deploy-tools@acme",
        confirmHash: hash,
        acceptCommand: "b".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    const second = await plugins.install({
      plugin: "deploy-tools@acme",
      confirmHash: hash,
      acceptCommand: shownCommand.sha256,
    });
    expect(second.outcome).toBe("ok");
    const sent = changes(fake);
    expect(sent).toEqual([
      "plugin install deploy-tools@acme --scope user --json",
      `plugin install deploy-tools@acme --scope user --json --accept-command ${shownCommand.sha256}`,
    ]);
    expect(sent.join(" ")).not.toMatch(/ -y| --yes/);
  });

  test("uma pasta local só se instala depois do validate, pelo marketplace de diretório", async () => {
    const dir = plugin({ ".claude-plugin/plugin.json": MANIFEST, "skills/x/SKILL.md": skill("x") });
    const bad = world((ctx) =>
      everything(ctx, [
        { args: ["validate", "--json"], code: 1, stdout: JSON.stringify({ success: false }) },
        { args: ["install"], stdout: OK("install") },
      ]),
    );
    await expect(
      bad.plugins.install({ dir, confirmHash: inspectPlugin(dir).hash }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(changes(bad.fake)).toEqual([]);
    const good = world((ctx) =>
      everything(ctx, [
        { args: ["validate", "--json"], stdout: JSON.stringify({ success: true }) },
        { args: ["install"], stdout: OK("install") },
      ]),
    );
    await good.plugins.install({ dir, confirmHash: inspectPlugin(dir).hash });
    expect(calls(good.fake)).toEqual([
      `plugin validate ${dir} --json`,
      `plugin install deploy-tools --marketplace ${dir} --scope user --json`,
    ]);
  });

  test("atualizar: a prévia mostra de onde e para onde, e o que entra e sai, depois de atualizar o marketplace", async () => {
    const { plugins, fake, marketplace } = world((ctx) =>
      everything(ctx, [{ args: ["marketplace", "update"], stdout: OK("marketplace-update") }]),
    );
    const source = join(marketplace, "plugins/deploy-tools");
    writeFileSync(
      join(source, ".claude-plugin/plugin.json"),
      JSON.stringify({ name: "deploy-tools", version: "1.3.0" }),
    );
    mkdirSync(join(source, "hooks"), { recursive: true });
    writeFileSync(
      join(source, "hooks/hooks.json"),
      JSON.stringify({
        hooks: { PermissionRequest: [{ hooks: [{ type: "command", command: "decide.sh" }] }] },
      }),
    );
    const preview = await plugins.previewUpdate("deploy-tools@acme");
    expect(preview).toMatchObject({ plugin: "deploy-tools@acme", unchanged: false });
    expect(preview.from.version).toBe("1.2.0");
    expect(preview.to).toEqual({ version: "1.3.0", hash: inspectPlugin(source).hash });
    expect(preview.diff.hooks).toEqual({
      added: ["PermissionRequest: decide.sh"],
      removed: ["PreToolUse: guard.sh"],
    });
    expect(preview.diff.skills).toEqual({ added: [], removed: [] });
    expect(calls(fake)[0]).toBe("plugin marketplace update acme --json");
  });

  test("atualizar pede o hash da prévia, não atualiza um fixado nem o que não mudou, e só então chama a CLI", async () => {
    const { plugins, fake, marketplace, installed, decisions } = world((ctx) =>
      everything(ctx, [
        { args: ["marketplace", "update"], stdout: OK("marketplace-update") },
        { args: ["update"], stdout: OK("update") },
      ]),
    );
    const source = join(marketplace, "plugins/deploy-tools");
    // Same content as installed: nothing to do, and the CLI never updates.
    cpSync(installed, source, { recursive: true });
    expect(await plugins.update({ plugin: "deploy-tools@acme", confirmHash: "x" })).toMatchObject({
      outcome: "unchanged",
    });
    writeFileSync(join(source, "extra.txt"), "novo");
    const to = (await plugins.previewUpdate("deploy-tools@acme")).to.hash;
    await expect(
      plugins.update({ plugin: "deploy-tools@acme", confirmHash: "errado" }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    await plugins.pin("deploy-tools@acme", true);
    await expect(
      plugins.update({ plugin: "deploy-tools@acme", confirmHash: to }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(changes(fake).filter((c) => c.startsWith("plugin update"))).toEqual([]);
    await plugins.pin("deploy-tools@acme", false);
    expect(await plugins.update({ plugin: "deploy-tools@acme", confirmHash: to })).toMatchObject({
      outcome: "ok",
    });
    expect(changes(fake).filter((c) => c.startsWith("plugin update"))).toEqual([
      "plugin update deploy-tools@acme --json",
    ]);
    expect(decisions).toEqual([
      { action: "update", target: "deploy-tools@acme", hash: to, at: "2026-10-31T12:00:00.000Z" },
    ]);
  });

  test("remover pede confirmação, usa só o escopo dado, nunca --prune nem -y, e solta o plugin fixado", async () => {
    const { plugins, fake, pins, decisions } = world((ctx) =>
      everything(ctx, [{ args: ["uninstall"], stdout: OK("uninstall") }]),
    );
    await plugins.pin("deploy-tools@acme", true);
    await expect(
      plugins.uninstall({ plugin: "deploy-tools@acme", confirm: false }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(changes(fake)).toEqual([]);
    expect(
      await plugins.uninstall({ plugin: "deploy-tools@acme", scope: "project", confirm: true }),
    ).toEqual({ outcome: "ok", message: "uninstall ok" });
    expect(changes(fake)).toEqual(["plugin uninstall deploy-tools@acme --scope project --json"]);
    expect(pins.data).toEqual({});
    expect(decisions).toEqual([
      { action: "uninstall", target: "deploy-tools@acme", at: "2026-10-31T12:00:00.000Z" },
    ]);
  });

  test("marketplaces: adicionar e remover pedem confirmação; atualizar não", async () => {
    const { plugins, fake, decisions } = world((ctx) =>
      everything(ctx, [
        { args: ["marketplace", "add"], stdout: OK("marketplace-add") },
        { args: ["marketplace", "remove"], stdout: OK("marketplace-remove") },
        { args: ["marketplace", "update"], stdout: OK("marketplace-update") },
      ]),
    );
    await expect(
      plugins.marketplaceAdd({ source: "acme/plugins", confirm: false }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    await expect(plugins.marketplaceRemove({ name: "acme", confirm: false })).rejects.toMatchObject(
      { code: "invalid_state" },
    );
    expect(changes(fake)).toEqual([]);
    await plugins.marketplaceAdd({ source: "acme/plugins", scope: "user", confirm: true });
    await plugins.marketplaceRemove({ name: "acme", confirm: true });
    await plugins.marketplaceUpdate("acme");
    expect(calls(fake)).toEqual([
      "plugin marketplace add acme/plugins --scope user --json",
      "plugin marketplace remove acme --json",
      "plugin marketplace update acme --json",
    ]);
    expect(decisions.map((d) => [d.action, d.target])).toEqual([
      ["marketplace-add", "acme/plugins"],
      ["marketplace-remove", "acme"],
    ]);
  });
});
