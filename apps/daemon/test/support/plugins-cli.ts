import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../../scripts/test/fake-cli.ts";
import { claudeCli } from "../../src/plugins/adapters/claude-plugin.ts";
import { inspectPlugin } from "../../src/plugins/inventory.ts";
import { Plugins } from "../../src/plugins/plugins.ts";
import type { Pin, PinStore, PluginDecision } from "../../src/plugins/ports.ts";
import { tempDir } from "./helpers.ts";
import { MANIFEST, plugin, skill } from "./plugin-fixtures.ts";

const fakes: FakeCli[] = [];
/** The `afterEach` of a suite that uses `world`: puts every fake `claude` back. */
export function restoreFakes() {
  for (const fake of fakes.splice(0)) fake.restore();
}

/** A `claude` that answers the rules, a marketplace folder with two plugins, and one installed. */
export type Ctx = { installed: string; marketplace: string };
/** What the real CLI would do to the installed folder after a change that went through. */
export const lands = (ctx: Ctx, args: string[]) => {
  const from = args.includes("--marketplace")
    ? (args[args.indexOf("--marketplace") + 1] as string)
    : join(ctx.marketplace, "plugins", "deploy-tools");
  rmSync(ctx.installed, { recursive: true, force: true });
  cpSync(from, ctx.installed, { recursive: true });
};

export function world(
  rules: (ctx: Ctx) => FakeRule[],
  effect?: (ctx: Ctx, args: string[]) => void,
) {
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
      record: (d) => {
        decisions.push(d);
      },
    }),
  };
}

export function memoryPins(): PinStore & { data: Record<string, Pin> } {
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

export const LISTING = (ctx: { installed: string; marketplace: string }): FakeRule[] => [
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

export const OK = (command: string, extra: Record<string, unknown> = {}) =>
  `${JSON.stringify({ command, outcome: "ok", message: `${command} ok`, ...extra })}\n`;
export const everything = (
  ctx: { installed: string; marketplace: string },
  more: FakeRule[],
): FakeRule[] => [...more, ...LISTING(ctx)];
export const calls = (fake: FakeCli) => fake.calls().map((c) => c.join(" "));
export const changes = (fake: FakeCli) =>
  calls(fake).filter((c) => /^plugin (install|update|uninstall|marketplace (add|remove))/.test(c));
export const hashOf = async (marketplace: string, name: string) =>
  (await inspectPlugin(join(marketplace, "plugins", name))).hash;
