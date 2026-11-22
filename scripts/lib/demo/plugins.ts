/**
 * The plugin folders and the `claude` answers behind the demo's Plugins prints (#3956). The real
 * CLI is never run: the host reads these folders itself, and asks the fake `claude` for the rest.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FakeRule } from "../../test/fake-cli.ts";
import { SKILL_MD } from "./seed-files.ts";

export interface DemoPluginFiles {
  /** What the demo's fake `claude plugin` answers. */
  rules: FakeRule[];
  /** A plugin folder the validation refuses: the local-folder print previews it. */
  refusedFolder: string;
}

/** The installed plugin whose name, chips, badge and four buttons must share one row at 390 px. */
const LONG_NAME = "deploy-tools-for-the-billing-and-reporting-teams";

const hooks = (events: Record<string, string>) =>
  JSON.stringify({
    hooks: Object.fromEntries(
      Object.entries(events).map(([event, command]) => [
        event,
        [{ matcher: "Bash", hooks: [{ type: "command", command }] }],
      ]),
    ),
  });

const manifest = (name: string, version: string, description: string) =>
  JSON.stringify({ name, version, description });

/** Writes files (path to text) under `root`. */
function write(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/**
 * Writes the demo's plugin folders under `work`: the `acme` marketplace (with a newer deploy-tools
 * and lint-rules), the two installed plugins and one folder `validate` refuses.
 */
export function writeDemoPlugins(work: string): DemoPluginFiles {
  const root = join(work, "plugins");
  const market = join(root, "acme");
  const installed = join(root, "installed");
  const refusedFolder = join(root, "broken");
  const guard = hooks({ PreToolUse: "guard.sh" });
  write(market, {
    ".claude-plugin/marketplace.json": JSON.stringify({
      name: "acme",
      plugins: [
        { name: "deploy-tools", source: "./deploy-tools" },
        { name: "lint-rules", source: "./lint-rules" },
      ],
    }),
    // The marketplace's copy is newer than the installed one: one more hook comes in.
    "deploy-tools/.claude-plugin/plugin.json": manifest("deploy-tools", "1.3.0", "Publica o app"),
    "deploy-tools/hooks/hooks.json": hooks({ PreToolUse: "guard.sh", PostToolUse: "notify.sh" }),
    "deploy-tools/skills/deploy/SKILL.md": SKILL_MD,
    "lint-rules/.claude-plugin/plugin.json": manifest(
      "lint-rules",
      "0.4.0",
      "Regras de lint para o time",
    ),
    "lint-rules/hooks/hooks.json": hooks({ PreToolUse: "lint-guard.sh" }),
    "lint-rules/commands/lint.md": "---\ndescription: Roda o lint\n---\nRode o lint.\n",
  });
  write(installed, {
    "deploy-tools/.claude-plugin/plugin.json": manifest("deploy-tools", "1.2.0", "Publica o app"),
    "deploy-tools/hooks/hooks.json": guard,
    "deploy-tools/skills/deploy/SKILL.md": SKILL_MD,
    [`${LONG_NAME}/.claude-plugin/plugin.json`]: manifest(
      LONG_NAME,
      "2.0.1",
      "Publica o faturamento",
    ),
    [`${LONG_NAME}/hooks/hooks.json`]: guard,
  });
  // No name in the manifest: what `validate` refuses.
  write(refusedFolder, {
    ".claude-plugin/plugin.json": JSON.stringify({ version: "0.1.0" }),
  });
  const installedOne = (name: string) => ({
    id: `${name}@acme`,
    version: name === "deploy-tools" ? "1.2.0" : "2.0.1",
    scope: "user",
    enabled: true,
    installPath: join(installed, name),
  });
  return {
    refusedFolder,
    rules: [
      {
        args: ["validate", refusedFolder],
        code: 1,
        stdout: JSON.stringify({
          success: false,
          manifest: { errors: [{ path: "name", message: "Required" }] },
        }),
      },
      // The update preview refreshes the marketplace first.
      {
        args: ["marketplace", "update"],
        stdout: JSON.stringify({ command: "marketplace update", outcome: "ok", message: "ok" }),
      },
      {
        args: ["marketplace", "list"],
        stdout: JSON.stringify([
          { name: "acme", source: "github", repo: "acme/plugins", installLocation: market },
        ]),
      },
      {
        args: ["list", "--json"],
        stdout: JSON.stringify({
          installed: [installedOne("deploy-tools"), installedOne(LONG_NAME)],
          available: [
            {
              pluginId: "lint-rules@acme",
              name: "lint-rules",
              marketplaceName: "acme",
              description: "Regras de lint para o time",
              version: "0.4.0",
            },
          ],
        }),
      },
    ],
  };
}
