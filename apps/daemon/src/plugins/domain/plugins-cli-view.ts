/**
 * Issue #3516: what `flightdeckd plugins list|detail|preview|preview-update` say, as pure rules over the
 * daemon's answers. The daemon calls and the exit codes stay in `plugins/plugins-cli.ts`.
 */
import type {
  InstalledPlugin,
  PluginChange,
  PluginList,
  PluginPreview,
  PluginUpdatePreview,
} from "@flightdeck/protocol";

/** What the person typed for `plugins <verb>`, as `runPluginsCli` takes it. `--json` prints the daemon's own answer. */
interface Printed {
  json?: boolean;
}
export type PluginsCliArgs =
  | (Printed & { action: "list" })
  | (Printed & { action: "detail"; plugin: string })
  | (Printed & { action: "preview-update"; plugin: string })
  | (Printed & { action: "preview"; plugin: string })
  | (Printed & { action: "preview"; dir: string })
  | (Printed & InstallArgs & { action: "install" })
  | (Printed & { action: "update"; plugin: string; confirmHash: string; acceptCommand?: string })
  | (Printed & { action: "uninstall"; plugin: string; scope?: PluginScope; confirm?: true })
  | (Printed & { action: "pin"; plugin: string })
  | (Printed & { action: "unpin"; plugin: string })
  | (Printed & { action: "marketplace-add"; source: string; scope?: PluginScope; confirm?: true })
  | (Printed & { action: "marketplace-remove"; name: string; confirm?: true })
  | (Printed & { action: "marketplace-update"; name?: string });

type PluginScope = "user" | "project" | "local";
/** An install names an installed-from marketplace plugin or a folder, and repeats the hash of its preview. */
type InstallArgs = ({ plugin: string } | { dir: string }) & {
  confirmHash: string;
  scope?: PluginScope;
  acceptCommand?: string;
};

/** The plural line of a count: `hooks: 2`, and how many of them can decide for the person. */
const count = (label: string, n: number, extra = "") => `${label}: ${n}${extra}`;

/** A marketplace added by a URL may carry `user:token@` in it; the line shows the URL without it. */
function withoutUserinfo(source: string): string {
  return source.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, "$1");
}

/**
 * Text the plugin manager or a marketplace wrote may name a URL with `user:token@` in it (a git error does):
 * the userinfo is cut, as `plugins list` does for a marketplace's source. Control characters are the printer's
 * to remove (`said`), and JSON escapes them.
 */
const plain = (text: string): string =>
  text.replace(USERINFO, (found, at: number) => (endsInScheme(text, at) ? "://" : found));

/** `://` and the userinfo after it: what is cut, once a scheme is known to stand in front of it. */
const USERINFO = /:\/\/[^/@\s]*@/g;

/** Whether the scheme characters that end at `end` hold a letter: a scheme starts with one, so `1http` is `http` but `+` is none. */
function endsInScheme(text: string, end: number): boolean {
  let letter = false;
  for (let i = end - 1; i >= 0 && /[a-z0-9+.-]/i.test(text.charAt(i)); i--) {
    letter ||= /[a-z]/i.test(text.charAt(i));
  }
  return letter;
}

/** A change with the URLs of the text the daemon relayed cut of their userinfo; the outcome and the hash are left as they are. */
export function plainChange(change: PluginChange): PluginChange {
  const { shownCommand } = change;
  return {
    ...change,
    message: plain(change.message),
    ...(shownCommand
      ? {
          shownCommand: {
            ...shownCommand,
            ...(shownCommand.command === undefined ? {} : { command: plain(shownCommand.command) }),
            ...(shownCommand.plugin === undefined ? {} : { plugin: plain(shownCommand.plugin) }),
          },
        }
      : {}),
  };
}

/** The lines of `plugins list`: the installed ones first, then what the marketplaces offer and the marketplaces. */
export function listLines(list: PluginList): string[] {
  const installed = list.installed.map((p) => {
    const state = p.enabled ? "enabled" : "disabled";
    const pin = p.pinned ? `  pinned ${p.pinned.version}` : "";
    return `installed  ${p.id}  ${p.version}  ${p.scope}  ${state}${pin}`;
  });
  const available = list.available.map(
    (p) => `available  ${p.id}${p.description ? `  ${p.description}` : ""}`,
  );
  const marketplaces = list.marketplaces.map(
    (m) => `marketplace  ${m.name}  ${withoutUserinfo(m.source)}`,
  );
  const lines = [...installed, ...available, ...marketplaces];
  return lines.length ? lines : ["no plugins"];
}

/** The lines of `plugins detail`: where it is, whether it is pinned, and how much of each kind it installs. */
export function detailLines(plugin: InstalledPlugin): string[] {
  const { inventory } = plugin;
  const lines = [
    `${plugin.id}  ${plugin.version}`,
    `scope: ${plugin.scope}`,
    `enabled: ${plugin.enabled ? "yes" : "no"}`,
    `path: ${plugin.path}`,
    ...(plugin.pinned ? [`pinned: ${plugin.pinned.version}`] : []),
  ];
  if (inventory === null) lines.push("content: not readable");
  else {
    const sensitive = inventory.hooks.filter((h) => h.sensitive).length;
    lines.push(
      `hash: ${inventory.hash}`,
      `needs your attention: ${inventory.attention ? "yes" : "no"}`,
      count("hooks", inventory.hooks.length, sensitive ? ` (${sensitive} can decide for you)` : ""),
      count("monitors", inventory.monitors.length),
      count("skills", inventory.skills.length),
      count("agents", inventory.agents.length),
      count("commands", inventory.commands.length),
      count("mcp servers", inventory.mcpServers.length),
    );
  }
  return [...lines, ...plugin.errors.map((e) => `error: ${e}`)];
}

type Inventory = NonNullable<PluginPreview["inventory"]>;

/** One line per thing an install brings, in the order the app's dialog lists them. */
function inventoryLines(inventory: Inventory): string[] {
  const hooks = inventory.hooks.map((h) => {
    const where = [h.event, h.matcher, h.type, h.command].filter(Boolean).join(" ");
    return `hook: ${where}${h.sensitive ? " (can decide for you)" : ""}`;
  });
  return [
    `hash: ${inventory.hash}`,
    `needs your attention: ${inventory.attention ? "yes" : "no"}`,
    ...hooks,
    ...inventory.monitors.map(
      (m) => `monitor: ${m.name}: ${m.command} (${m.description}, when ${m.when})`,
    ),
    ...inventory.skills.map((n) => `skill: ${n}`),
    ...inventory.agents.map((n) => `agent: ${n}`),
    ...inventory.commands.map((n) => `command: ${n}`),
    ...inventory.mcpServers.map((m) => `mcp server: ${m.name} ${m.transport} ${m.target}`),
    `${inventory.files} files, ${inventory.bytes} bytes`,
    ...inventory.problems.map((p) => `problem: ${p}`),
  ];
}

/** The lines of `plugins preview`: what an install would bring and the hash an install repeats; no hash when the content is not local. */
export function previewLines(preview: PluginPreview): string[] {
  const head = preview.version ? `${preview.plugin}  ${preview.version}` : preview.plugin;
  if (preview.reason === "not-local")
    return [head, "not local: its content cannot be shown, so it has no hash"];
  const body =
    preview.inventory === null ? ["content: not readable"] : inventoryLines(preview.inventory);
  const check = preview.validation
    ? [
        `validation: ${preview.validation.success ? "ok" : "failed"}`,
        ...preview.validation.errors.map((e) => `validation error: ${e}`),
      ]
    : [];
  return [head, ...body, ...check];
}

const KINDS = [
  ["hooks", "hooks"],
  ["monitors", "monitors"],
  ["skills", "skills"],
  ["agents", "agents"],
  ["commands", "commands"],
  ["mcpServers", "mcp servers"],
] as const;

/** The lines of `plugins preview-update`: the installed copy against the marketplace's, and what moved. */
export function updateLines(update: PluginUpdatePreview): string[] {
  const moved = KINDS.flatMap(([key, label]) => {
    const { added, removed } = update.diff[key];
    return [
      ...(added.length ? [`${label}: added ${added.join(", ")}`] : []),
      ...(removed.length ? [`${label}: removed ${removed.join(", ")}`] : []),
    ];
  });
  return [
    update.plugin,
    `from: ${update.from.version} ${update.from.hash}`,
    `to: ${update.to.version} ${update.to.hash}`,
    ...moved,
    ...(update.unchanged ? ["unchanged: the marketplace's copy is the installed one"] : []),
  ];
}

/**
 * What a write said, as lines and an exit code: `ok` and `unchanged` are done (0); a failed or rolled back
 * change is refused (1); a command the marketplace declares waits for the person, who reads it here and
 * repeats its sha256 with `--accept-command` (1, nothing was installed).
 */
export function changeLines(change: PluginChange): { code: 0 | 1; lines: string[] } {
  if (change.outcome === "ok" || change.outcome === "unchanged")
    return { code: 0, lines: [change.message] };
  const { shownCommand } = change;
  if (change.outcome !== "needs-command-confirmation" || shownCommand === undefined)
    return { code: 1, lines: [change.message] };
  return {
    code: 1,
    lines: [
      change.message,
      ...(shownCommand.plugin ? [`plugin: ${shownCommand.plugin}`] : []),
      ...(shownCommand.command ? [`command: ${shownCommand.command}`] : []),
      `sha256: ${shownCommand.sha256}`,
      `Nothing was installed. After reading the command, repeat the same line with --accept-command ${shownCommand.sha256}`,
    ],
  };
}
