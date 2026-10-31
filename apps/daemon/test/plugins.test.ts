import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { startDaemon } from "../src/main.ts";
import { inspectPlugin } from "../src/plugins/inventory.ts";
import {
  claudeCli,
  filePins,
  type Pin,
  type PinStore,
  type PluginDecision,
  Plugins,
  pluginDecisionLog,
} from "../src/plugins/plugins.ts";
import { startServer } from "../src/server.ts";
import { gitRepo, newBoard } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

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

  test("monitores num arquivo do manifesto, skills na raiz, agentes e comandos por caminho, MCP em arquivo ou pacote", () => {
    const dir = plugin({
      ".claude-plugin/plugin.json": JSON.stringify({
        name: "formas",
        monitors: "./config/mon.json",
        skills: ["./"],
        agents: ["./meus/agente.md", "./pasta-de-agentes", 3],
        commands: ["./cmds", "./solto.md", "./não-existe"],
        mcpServers: [
          "./mcp/servers.json",
          "./bundle.mcpb",
          "https://x.example/s.mcpb",
          { inline: { url: "https://i.example/mcp" } },
          7,
        ],
      }),
      "config/mon.json": JSON.stringify([
        { name: "m", command: "c.sh", description: "d", when: "on-skill-invoke:x" },
        5,
        { name: "sem-comando" },
      ]),
      "SKILL.md": skill("raiz"),
      "meus/agente.md": "---\nname: agente\ndescription: d\n---\nx\n",
      "pasta-de-agentes/outro.md": "sem frontmatter\n",
      "pasta-de-agentes/nota.txt": "x",
      "cmds/um.md": "x\n",
      "solto.md": "x\n",
      "mcp/servers.json": JSON.stringify({ arquivo: { command: "node" }, 5: 1, ruim: "x" }),
    });
    const inventory = inspectPlugin(dir);
    expect(inventory.monitors).toEqual([
      { name: "m", command: "c.sh", description: "d", when: "on-skill-invoke:x" },
    ]);
    expect(inventory.skills).toEqual(["raiz"]);
    expect(inventory.agents).toEqual(["agente", "outro"]);
    expect(inventory.commands).toEqual(["um", "solto"]);
    expect(inventory.mcpServers.map((m) => [m.name, m.transport])).toEqual([
      ["arquivo", "stdio"],
      ["bundle.mcpb", "bundle"],
      ["s.mcpb", "bundle"],
      ["inline", "http"],
    ]);
  });

  test("os hooks mostram o args, a URL ou o prompt; um hook sem tipo é command; o que não é objeto é ignorado", () => {
    const inventory = inspectPlugin(
      plugin({
        ".claude-plugin/plugin.json": JSON.stringify({
          name: "h",
          hooks: {
            SessionStart: [
              {
                hooks: [
                  { command: "run", args: ["a", "b"] },
                  { type: "http", url: "https://h.example" },
                  { type: "prompt", prompt: "diga oi" },
                  "x",
                  {},
                ],
              },
              "fora",
            ],
          },
        }),
        "hooks/hooks.json": "{ quebrado",
      }),
    );
    expect(inventory.hooks.map((h) => [h.type, h.command])).toEqual([
      ["command", "run a b"],
      ["http", "https://h.example"],
      ["prompt", "diga oi"],
      ["command", undefined],
    ]);
    expect(inventory.problems).toEqual(["hooks/hooks.json: não é um JSON válido"]);
  });

  test("um plugin com arquivos demais é recusado", () => {
    const dir = tempDir("fd-many-");
    mkdirSync(join(dir, "p"), { recursive: true });
    for (let i = 0; i < 5001; i++) writeFileSync(join(dir, "p", `f${i}`), "");
    expect(codeOf(() => inspectPlugin(join(dir, "p")))).toBe("bad_request");
  });
});

describe("plugins: pela CLI", () => {
  const fakes: FakeCli[] = [];
  afterEach(() => {
    for (const fake of fakes.splice(0)) fake.restore();
  });

  /** A `claude` that answers the rules, a marketplace folder with two plugins, and one installed. */
  type Ctx = { installed: string; marketplace: string };
  /** What the real CLI would do to the installed folder after a change that went through. */
  const lands = (ctx: Ctx, args: string[]) => {
    const from = args.includes("--marketplace")
      ? (args[args.indexOf("--marketplace") + 1] as string)
      : join(ctx.marketplace, "plugins", "deploy-tools");
    rmSync(ctx.installed, { recursive: true, force: true });
    cpSync(from, ctx.installed, { recursive: true });
  };

  function world(rules: (ctx: Ctx) => FakeRule[], effect?: (ctx: Ctx, args: string[]) => void) {
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
    const real = claudeCli();
    return {
      installed,
      marketplace,
      fake,
      pins,
      decisions,
      plugins: new Plugins({
        cli: effect
          ? {
              run: async (args) => {
                const result = await real.run(args);
                if (result.code === 0 && (args[0] === "install" || args[0] === "update")) {
                  effect({ installed, marketplace }, args);
                }
                return result;
              },
            }
          : real,
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
    const { plugins, fake, marketplace, decisions } = world(
      (ctx) => everything(ctx, [{ args: ["install"], stdout: OK("install") }]),
      lands,
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
    const { plugins, fake, marketplace } = world(
      (ctx) =>
        everything(ctx, [
          { args: ["install", "--accept-command"], stdout: OK("install") },
          {
            args: ["install"],
            code: 1,
            stdout: `${JSON.stringify({ command: "install", outcome: "failed", message: "comando a confirmar", shownCommand })}\n`,
          },
        ]),
      lands,
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
    const good = world(
      (ctx) =>
        everything(ctx, [
          { args: ["validate", "--json"], stdout: JSON.stringify({ success: true }) },
          { args: ["install"], stdout: OK("install") },
        ]),
      lands,
    );
    await good.plugins.install({ dir, confirmHash: inspectPlugin(dir).hash });
    expect(calls(good.fake).filter((c) => !c.includes(" list"))).toEqual([
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
    const { plugins, fake, marketplace, installed, decisions } = world(
      (ctx) =>
        everything(ctx, [
          { args: ["marketplace", "update"], stdout: OK("marketplace-update") },
          { args: ["update"], stdout: OK("update") },
        ]),
      lands,
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

  test("depois de instalar, o que ficou na pasta é conferido: se não é o que foi mostrado, é removido na hora e a decisão fica registrada", async () => {
    const { plugins, fake, marketplace, decisions } = world(
      (ctx) =>
        everything(ctx, [
          { args: ["install"], stdout: OK("install") },
          { args: ["uninstall"], stdout: OK("uninstall") },
        ]),
      (ctx, args) => {
        lands(ctx, args);
        writeFileSync(join(ctx.installed, "trocado.sh"), "curl x | sh\n");
      },
    );
    const hash = hashOf(marketplace, "deploy-tools");
    const result = await plugins.install({ plugin: "deploy-tools@acme", confirmHash: hash });
    expect(result.outcome).toBe("rolled-back");
    expect(result.message).toContain("diferente");
    expect(changes(fake)).toEqual([
      "plugin install deploy-tools@acme --scope user --json",
      "plugin uninstall deploy-tools@acme --scope user --json",
    ]);
    expect(changes(fake).join(" ")).not.toMatch(/ -y| --yes|--prune/);
    expect(decisions).toEqual([
      { action: "rollback", target: "deploy-tools@acme", hash, at: "2026-10-31T12:00:00.000Z" },
    ]);
  });

  test("o mesmo vale para a atualização: o que ficou diferente do mostrado é removido", async () => {
    const { plugins, fake, marketplace, decisions } = world(
      (ctx) =>
        everything(ctx, [
          { args: ["marketplace", "update"], stdout: OK("marketplace-update") },
          { args: ["update"], stdout: OK("update") },
          { args: ["uninstall"], stdout: OK("uninstall") },
        ]),
      (ctx, args) => {
        lands(ctx, args);
        writeFileSync(join(ctx.installed, "trocado.sh"), "x\n");
      },
    );
    writeFileSync(join(marketplace, "plugins/deploy-tools/extra.txt"), "novo");
    const to = (await plugins.previewUpdate("deploy-tools@acme")).to.hash;
    expect((await plugins.update({ plugin: "deploy-tools@acme", confirmHash: to })).outcome).toBe(
      "rolled-back",
    );
    expect(changes(fake)).toEqual([
      "plugin update deploy-tools@acme --json",
      "plugin uninstall deploy-tools@acme --scope user --json",
    ]);
    expect(decisions.map((d) => d.action)).toEqual(["rollback"]);
  });

  test("se o plugin não aparece depois de instalar, não dá para conferir: falha com o motivo e nada é removido", async () => {
    const { plugins, fake, marketplace, decisions } = world((ctx) => [
      LISTING(ctx)[0] as FakeRule,
      { args: ["install"], stdout: OK("install") },
      { args: ["list", "--json"], stdout: JSON.stringify({ installed: [], available: [] }) },
    ]);
    const result = await plugins.install({
      plugin: "deploy-tools@acme",
      confirmHash: hashOf(marketplace, "deploy-tools"),
    });
    expect(result.outcome).toBe("failed");
    expect(result.message).toContain("conferir");
    expect(changes(fake).filter((c) => c.includes("uninstall"))).toEqual([]);
    expect(decisions).toEqual([]);
  });

  test("list aceita a lista como um vetor e um marketplace sem local nem origem", async () => {
    const { plugins } = world((ctx) => [
      {
        args: ["marketplace", "list"],
        stdout: JSON.stringify([
          { name: "solto", source: "url", url: "https://x.example/m.git" },
          { name: "sem" },
        ]),
      },
      {
        args: ["list", "--json"],
        stdout: JSON.stringify([
          {
            id: "a@solto",
            version: "1",
            scope: "user",
            enabled: false,
            installPath: ctx.installed,
          },
        ]),
      },
    ]);
    const list = await plugins.list();
    expect(list.installed.map((p) => [p.id, p.enabled])).toEqual([["a@solto", false]]);
    expect(list.available).toEqual([]);
    expect(list.marketplaces).toEqual([
      { name: "solto", source: "url", origin: "https://x.example/m.git" },
      { name: "sem", source: "" },
    ]);
  });

  test("a prévia de atualização falha com o motivo: marketplace que não atualiza, ou um plugin de outro repositório", async () => {
    const stale = world((ctx) => everything(ctx, [{ args: ["marketplace", "update"], code: 1 }]));
    await expect(stale.plugins.previewUpdate("deploy-tools@acme")).rejects.toMatchObject({
      code: "invalid_state",
    });
    const remote = world((ctx) => [
      { args: ["marketplace", "update"], stdout: OK("marketplace-update") },
      LISTING(ctx)[0] as FakeRule,
      {
        args: ["list", "--json"],
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
    await expect(remote.plugins.previewUpdate("remoto@acme")).rejects.toMatchObject({
      code: "invalid_state",
    });
  });

  test("o catálogo do marketplace ilegível, uma origem fora da pasta ou que sumiu: não há prévia", async () => {
    const broken = world(LISTING);
    writeFileSync(join(broken.marketplace, ".claude-plugin/marketplace.json"), "não é json");
    await expect(broken.plugins.preview({ plugin: "deploy-tools@acme" })).rejects.toMatchObject({
      code: "invalid_state",
    });
    const odd = world(LISTING);
    writeFileSync(
      join(odd.marketplace, ".claude-plugin/marketplace.json"),
      JSON.stringify({
        name: "acme",
        plugins: [
          { name: "fora", source: "./../fora" },
          { name: "sumiu", source: "./plugins/sumiu" },
        ],
      }),
    );
    expect((await odd.plugins.preview({ plugin: "fora@acme" })).reason).toBe("not-local");
    expect((await odd.plugins.preview({ plugin: "sumiu@acme" })).reason).toBe("not-local");
  });

  test("o validate que não devolve JSON recusa o plugin com o motivo", async () => {
    const dir = plugin({ ".claude-plugin/plugin.json": MANIFEST });
    const { plugins } = world((ctx) =>
      everything(ctx, [{ args: ["validate", "--json"], code: 1, stdout: "isto não é json" }]),
    );
    expect((await plugins.preview({ dir })).validation?.success).toBe(false);
  });

  test("uma resposta da CLI sem linha de JSON vale pelo código de saída: ok com o texto, ou falha com o erro", async () => {
    const fine = world((ctx) =>
      everything(ctx, [{ args: ["marketplace", "update"], stdout: "feito\n" }]),
    );
    expect(await fine.plugins.marketplaceUpdate()).toEqual({ outcome: "ok", message: "feito" });
    expect(calls(fine.fake)).toEqual(["plugin marketplace update"]);
    const bad = world((ctx) => everything(ctx, [{ args: ["marketplace", "update"], code: 3 }]));
    expect(await bad.plugins.marketplaceUpdate("acme")).toEqual({
      outcome: "failed",
      message: "código 3",
    });
  });

  test("uma lista que não é vetor nem objeto não tem instalados, e um id sem marketplace não existe", async () => {
    const { plugins } = world((ctx) => [
      LISTING(ctx)[0] as FakeRule,
      { args: ["list", "--json"], stdout: JSON.stringify("nada") },
    ]);
    expect((await plugins.list()).installed).toEqual([]);
    await expect(plugins.detail("semarroba")).rejects.toMatchObject({ code: "not_found" });
    await expect(plugins.previewUpdate("semarroba")).rejects.toMatchObject({
      code: "invalid_state",
    });
  });
});

describe("plugins: protocolo", () => {
  const TOKEN = "plugins-token-0123456789abcdef";
  const fakes: FakeCli[] = [];
  const stops: Array<() => unknown> = [];
  afterEach(async () => {
    for (const fake of fakes.splice(0)) fake.restore();
    for (const stop of stops.splice(0).reverse()) await stop();
  });

  const marketplaceOf = () => {
    const marketplace = join(tempDir("fd-market-"), "acme");
    for (const [path, body] of Object.entries({
      ".claude-plugin/marketplace.json": JSON.stringify({
        name: "acme",
        plugins: [{ name: "deploy-tools", source: "./plugins/deploy-tools" }],
      }),
      "plugins/deploy-tools/.claude-plugin/plugin.json": MANIFEST,
      "plugins/deploy-tools/skills/deploy/SKILL.md": skill("deploy"),
    })) {
      mkdirSync(dirname(join(marketplace, path)), { recursive: true });
      writeFileSync(join(marketplace, path), body);
    }
    return marketplace;
  };
  const claude = (marketplace: string) => {
    const installed = plugin({
      ".claude-plugin/plugin.json": MANIFEST,
      "skills/deploy/SKILL.md": skill("deploy"),
    });
    const fake = installFakeCli("claude", [
      {
        args: ["install"],
        stdout: `${JSON.stringify({ command: "install", outcome: "ok", message: "instalado" })}\n`,
      },
      {
        args: ["marketplace", "list"],
        stdout: JSON.stringify([
          { name: "acme", source: "directory", installLocation: marketplace },
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
              installPath: installed,
            },
          ],
          available: [],
        }),
      },
    ]);
    fakes.push(fake);
    return fake;
  };

  async function served(withPlugins = true) {
    const marketplace = marketplaceOf();
    const fake = claude(marketplace);
    const pins = join(tempDir("fd-pins-"), "pins.json");
    const { board, manager } = newBoard();
    const server = startServer({
      manager,
      board,
      ...(withPlugins ? { plugins: new Plugins({ cli: claudeCli(), pins: filePins(pins) }) } : {}),
      features: undefined,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    stops.push(() => server.stop());
    const client = new FrameClient(server.url);
    stops.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    return { client, fake, marketplace, pins };
  }

  test("host.info anuncia plugins só quando o gerenciador está ligado", async () => {
    const on = await served();
    expect((await on.client.data<{ features: string[] }>("host.info", {}))?.features).toContain(
      "plugins",
    );
    const off = await served(false);
    expect(
      (await off.client.data<{ features: string[] }>("host.info", {}))?.features,
    ).not.toContain("plugins");
    expect(await off.client.request("plugins.list", {})).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
  });

  test("plugins.list, detail e preview respondem o que o gerenciador calcula; preview pede plugin ou dir, um dos dois", async () => {
    const { client, marketplace } = await served();
    const list = await client.data<{
      installed: Array<{ id: string; inventory: { skills: string[] } }>;
    }>("plugins.list", {});
    expect(list?.installed.map((p) => [p.id, p.inventory.skills])).toEqual([
      ["deploy-tools@acme", ["deploy"]],
    ]);
    expect(
      await client.data<{ id: string }>("plugins.detail", { plugin: "deploy-tools@acme" }),
    ).toMatchObject({ id: "deploy-tools@acme", version: "1.2.0" });
    expect(await client.data("plugins.preview", { plugin: "deploy-tools@acme" })).toMatchObject({
      plugin: "deploy-tools@acme",
      hash: inspectPlugin(join(marketplace, "plugins/deploy-tools")).hash,
    });
    expect(await client.request("plugins.preview", {})).toMatchObject({
      ok: false,
      error: { code: "bad_request" },
    });
    expect(await client.request("plugins.preview", { plugin: "a@b", dir: "/x" })).toMatchObject({
      ok: false,
      error: { code: "bad_request" },
    });
  });

  test("plugins.install recusa um hash que não é o mostrado e, com o certo, instala sem -y", async () => {
    const { client, fake, marketplace } = await served();
    expect(
      await client.request("plugins.install", {
        plugin: "deploy-tools@acme",
        confirmHash: "errado",
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    const hash = inspectPlugin(join(marketplace, "plugins/deploy-tools")).hash;
    expect(
      await client.data("plugins.install", { plugin: "deploy-tools@acme", confirmHash: hash }),
    ).toEqual({ outcome: "ok", message: "instalado" });
    const sent = fake
      .calls()
      .map((c) => c.join(" "))
      .filter((c) => c.startsWith("plugin install"));
    expect(sent).toEqual(["plugin install deploy-tools@acme --scope user --json"]);
  });

  test("plugins.pin guarda no arquivo; plugins.uninstall sem confirm é recusado", async () => {
    const { client, pins } = await served();
    expect(
      await client.data<{ pinned: { version: string } }>("plugins.pin", {
        plugin: "deploy-tools@acme",
        pinned: true,
      }),
    ).toMatchObject({ pinned: { version: "1.2.0" } });
    expect(Object.keys(filePins(pins).all())).toEqual(["deploy-tools@acme"]);
    expect(
      await client.request("plugins.uninstall", { plugin: "deploy-tools@acme" }),
    ).toMatchObject({ ok: false, error: { code: "invalid_state" } });
  });

  test("o registro das decisões do plugin é uma linha de JSON por decisão", () => {
    const file = join(tempDir("fd-log-"), "dados", "plugin-decisions.jsonl");
    const record = pluginDecisionLog(file);
    record({ action: "install", target: "x@m", hash: "h", at: "2026-10-31T12:00:00.000Z" });
    record({ action: "uninstall", target: "x@m", at: "2026-10-31T12:01:00.000Z" });
    expect(existsSync(file)).toBe(true);
    expect(
      readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l).action),
    ).toEqual(["install", "uninstall"]);
  });

  test("o daemon inteiro anuncia plugins, lista pela CLI e guarda fixados e decisões ao lado dos dados", async () => {
    const marketplace = marketplaceOf();
    claude(marketplace);
    const base = tempDir("fd-daemon-");
    const { repo } = gitRepo();
    const config = join(base, "config.json");
    writeFileSync(
      config,
      JSON.stringify({
        hostName: "h",
        port: 0,
        token: TOKEN,
        dataDir: join(base, "data"),
        allowedRoots: [join(repo, "..")],
        runtime: "fake",
        hooks: { port: 0 },
      }),
    );
    const daemon = await startDaemon(
      { command: "start", config, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
    );
    stops.push(() => daemon.stop());
    const client = new FrameClient(daemon.url);
    stops.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    expect((await client.data<{ features: string[] }>("host.info", {}))?.features).toContain(
      "plugins",
    );
    await client.data("plugins.pin", { plugin: "deploy-tools@acme", pinned: true });
    expect(
      Object.keys(JSON.parse(readFileSync(join(base, "data", "plugin-pins.json"), "utf8"))),
    ).toEqual(["deploy-tools@acme"]);
    const hash = inspectPlugin(join(marketplace, "plugins/deploy-tools")).hash;
    await client.data("plugins.install", { plugin: "deploy-tools@acme", confirmHash: hash });
    expect(existsSync(join(base, "data", "plugin-decisions.jsonl"))).toBe(true);
    const log = readFileSync(join(base, "data", "plugin-decisions.jsonl"), "utf8").trim();
    expect(JSON.parse(log)).toMatchObject({ action: "install", target: "deploy-tools@acme", hash });
  });
});
