import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { inspectPlugin } from "../src/plugins/inventory.ts";
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
