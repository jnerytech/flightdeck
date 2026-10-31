import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import type { AppStore } from "../src/lib/app-store.ts";
import { daemon as makeDaemon, TOKEN } from "./fixtures.ts";

export const MANIFEST = JSON.stringify({
  name: "deploy-tools",
  version: "1.2.0",
  description: "Publica o app",
  author: { name: "Equipe" },
});
const SKILL = "---\nname: deploy\ndescription: publica\n---\ncorpo\n";
const HOOKS = JSON.stringify({
  hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }] },
});

/** Writes files (path to text) under `root`. */
export function write(root: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

export const ok = (command: string, extra: Record<string, unknown> = {}) =>
  `${JSON.stringify({ command, outcome: "ok", message: `${command} ok`, ...extra })}\n`;

/**
 * A real daemon with the plugins, a `claude` that answers from the rules, a marketplace folder
 * with two local plugins and one from another repository, and `deploy-tools` installed.
 */
export async function pluginsHost(
  cleanups: Array<() => unknown>,
  store: AppStore,
  fakes: FakeCli[],
  extra: (ctx: { installed: string; marketplace: string }) => FakeRule[] = () => [],
) {
  const d = makeDaemon(cleanups, { plugins: true });
  const marketplace = join(d.root, "market", "acme");
  write(marketplace, {
    ".claude-plugin/marketplace.json": JSON.stringify({
      name: "acme",
      plugins: [
        { name: "deploy-tools", source: "./plugins/deploy-tools" },
        { name: "outro", source: "./plugins/outro" },
        { name: "remoto", source: { source: "github", repo: "acme/remoto" } },
      ],
    }),
    "plugins/deploy-tools/.claude-plugin/plugin.json": MANIFEST,
    "plugins/deploy-tools/hooks/hooks.json": HOOKS,
    "plugins/deploy-tools/skills/deploy/SKILL.md": SKILL,
    "plugins/outro/.claude-plugin/plugin.json": JSON.stringify({ name: "outro", version: "0.1.0" }),
    "plugins/outro/commands/ola.md": "---\ndescription: oi\n---\nola\n",
    "plugins/outro/.mcp.json": JSON.stringify({
      mcpServers: { api: { command: "node", args: ["s.js"] } },
    }),
  });
  const installed = join(d.root, "installed", "deploy-tools");
  cpSync(join(marketplace, "plugins/deploy-tools"), installed, { recursive: true });
  const ctx = { installed, marketplace };
  const fake = installFakeCli("claude", [
    ...extra(ctx),
    {
      args: ["marketplace", "list"],
      stdout: JSON.stringify([
        { name: "acme", source: "directory", path: marketplace, installLocation: marketplace },
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
        available: [
          {
            pluginId: "outro@acme",
            name: "outro",
            marketplaceName: "acme",
            description: "Outro plugin",
            version: "0.1.0",
          },
          {
            pluginId: "remoto@acme",
            name: "remoto",
            marketplaceName: "acme",
            description: "De outro repositório",
          },
        ],
      }),
    },
  ]);
  fakes.push(fake);
  const hostId = await store.addHost({ name: "pc", url: d.listen().url, token: TOKEN });
  const deadline = Date.now() + 5000;
  while (store.getState().hosts[0]?.status !== "online" && Date.now() < deadline) {
    await Bun.sleep(10);
  }
  return { d, hostId, fake, installed, marketplace };
}
