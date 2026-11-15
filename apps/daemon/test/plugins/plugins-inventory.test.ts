import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { inspectPlugin } from "../../src/plugins/inventory.ts";
import { tempDir } from "../support/helpers.ts";
import { MANIFEST, plugin, skill } from "../support/plugin-fixtures.ts";

const codeOf = async (fn: () => unknown): Promise<string> => {
  try {
    await fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
};

describe("plugins: o inventário", () => {
  test("lê o manifesto e cada componente nos lugares de sempre, sem executar nada", async () => {
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
    const inventory = await inspectPlugin(dir);
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

  test("o manifesto muda onde olhar: hooks e MCP em arquivo ou na linha, monitores, comandos em mapa e skills extra", async () => {
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
    const inventory = await inspectPlugin(dir);
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

  test("o selo de atenção vale para quem escuta PreToolUse ou PermissionRequest, e só para eles", async () => {
    const withEvent = async (event: string) =>
      (
        await inspectPlugin(
          plugin({
            ".claude-plugin/plugin.json": MANIFEST,
            "hooks/hooks.json": JSON.stringify({
              hooks: { [event]: [{ hooks: [{ type: "command", command: "x" }] }] },
            }),
          }),
        )
      ).attention;
    expect(await withEvent("PreToolUse")).toBe(true);
    expect(await withEvent("PermissionRequest")).toBe(true);
    expect(await withEvent("PostToolUse")).toBe(false);
    expect(await withEvent("SessionStart")).toBe(false);
    expect(
      (await inspectPlugin(plugin({ ".claude-plugin/plugin.json": MANIFEST }))).attention,
    ).toBe(false);
  });

  test("o hash cobre todo o conteúdo: igual para o mesmo conteúdo, diferente se um byte, um nome ou um arquivo muda", async () => {
    const files = { ".claude-plugin/plugin.json": MANIFEST, "skills/a/SKILL.md": skill("a") };
    const a = await inspectPlugin(plugin(files));
    const dir = plugin(files);
    const old = new Date(Date.UTC(2020, 0, 1));
    utimesSync(join(dir, "skills/a/SKILL.md"), old, old);
    const b = await inspectPlugin(dir);
    expect(b.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.hash).toBe(a.hash);
    expect(b.files).toBe(2);
    expect(b.bytes).toBe(Buffer.byteLength(MANIFEST) + Buffer.byteLength(skill("a")));
    const changed = async (extra: Record<string, string>) =>
      (await inspectPlugin(plugin({ ...files, ...extra }))).hash;
    expect(await changed({ "skills/a/SKILL.md": `${skill("a")}x` })).not.toBe(a.hash);
    expect(await changed({ "novo.txt": "" })).not.toBe(a.hash);
    const renamed = await inspectPlugin(
      plugin({ ".claude-plugin/plugin.json": MANIFEST, "skills/b/SKILL.md": skill("a") }),
    );
    expect(renamed.hash).not.toBe(a.hash);
    expect(createHash("sha256").update("").digest("hex")).not.toBe(a.hash);
  });

  test("a pasta .git fica fora do hash", async () => {
    const files = { ".claude-plugin/plugin.json": MANIFEST };
    const withGit = await inspectPlugin(plugin({ ...files, ".git/HEAD": "ref: x\n" }));
    expect(withGit.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(withGit.hash).toBe((await inspectPlugin(plugin(files))).hash);
    expect(withGit.files).toBe(1);
  });

  test("caminho do manifesto que sai do plugin é recusado e anotado; link para fora não é seguido", async () => {
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
    const inventory = await inspectPlugin(dir);
    expect(inventory.hooks).toEqual([]);
    expect(inventory.attention).toBe(false);
    expect(inventory.skills).toEqual([]);
    expect(inventory.problems).toEqual(["hooks: caminho fora do plugin: ../../outside/hooks.json"]);
  });

  test("manifesto quebrado vira um problema, não uma falha; pasta que não existe é not_found", async () => {
    const inventory = await inspectPlugin(
      plugin({ ".claude-plugin/plugin.json": "{ não é json", "skills/a/SKILL.md": skill("a") }),
    );
    expect(inventory.manifest).toBeNull();
    expect(inventory.skills).toEqual(["a"]);
    expect(inventory.problems).toEqual(["plugin.json: not valid JSON"]);
    expect(await codeOf(() => inspectPlugin(join(tempDir("fd-none-"), "nada")))).toBe("not_found");
  });

  test("monitores num arquivo do manifesto, skills na raiz, agentes e comandos por caminho, MCP em arquivo ou pacote", async () => {
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
    const inventory = await inspectPlugin(dir);
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

  test("os hooks mostram o args, a URL ou o prompt; um hook sem tipo é command; o que não é objeto é ignorado", async () => {
    const inventory = await inspectPlugin(
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
    expect(inventory.problems).toEqual(["hooks/hooks.json: not valid JSON"]);
  });

  test("um plugin com arquivos demais é recusado", async () => {
    const dir = tempDir("fd-many-");
    mkdirSync(join(dir, "p"), { recursive: true });
    for (let i = 0; i < 5001; i++) writeFileSync(join(dir, "p", `f${i}`), "");
    expect(await codeOf(() => inspectPlugin(join(dir, "p")))).toBe("bad_request");
  });

  test("o conteúdo passa de 50 MB: o hash recusa pelo tamanho declarado, sem ler o arquivo", async () => {
    const dir = plugin({ ".claude-plugin/plugin.json": MANIFEST });
    // A sparse file: it declares 60 MB and holds nothing, so a read of it would be cheap but wrong.
    writeFileSync(join(dir, "enorme.bin"), "");
    truncateSync(join(dir, "enorme.bin"), 60 * 1024 * 1024);
    expect(await codeOf(() => inspectPlugin(dir))).toBe("bad_request");
  });
});
