/**
 * Issue #3516: what the `plugins` verbs of the CLI take, checked before anything is sent. The parser in
 * `args.ts` adds the usage text to the problem this names.
 */
import { isAbsolute } from "node:path";
import type { PluginsCliArgs } from "../../plugins/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { oneOf } from "./vault-args.ts";

/** The parsed arguments this check reads: `CliArgs` fits it. */
export interface PluginsArgs {
  command: string;
  action?: string;
  plugin?: string;
  pluginDir?: string;
  host?: string;
  confirm?: true;
  confirmHash?: string;
  acceptCommand?: string;
  pluginScope?: string;
}

const INSTALLS = ["install", "update"];
const WITH_SCOPE = ["install", "uninstall", "marketplace-add"];
const CONFIRMED = ["uninstall", "marketplace-add", "marketplace-remove"];
/** The flags that belong to some `plugins` verbs only: the flag, whether it was typed, and the verbs. */
const flagged = (args: PluginsArgs): Array<[string, boolean, readonly string[]]> => [
  ["--dir", args.pluginDir !== undefined, ["preview", "install"]],
  ["--confirm-hash", args.confirmHash !== undefined, INSTALLS],
  ["--accept-command", args.acceptCommand !== undefined, INSTALLS],
  ["--plugin-scope", args.pluginScope !== undefined, WITH_SCOPE],
  ["--confirm", args.confirm === true, CONFIRMED],
];

/** A flag outside the verbs that take it. */
function strayFlag(args: PluginsArgs, plugins: boolean): string | undefined {
  for (const [flag, typed, verbs] of flagged(args)) {
    if (!typed) continue;
    // `--confirm` is also the other commands' own, which check it themselves.
    if (flag === "--confirm" && !plugins) continue;
    if (!plugins || !verbs.includes(args.action ?? ""))
      return `${flag}: this flag only applies to flightdeckd plugins ${verbs.join(", ")}`;
  }
  return undefined;
}

/**
 * What is wrong with the `plugins` words and flags: a flag outside its verbs, a preview or an install that
 * names no plugin or two, and an install or an update without the hash of the preview the person read.
 */
export function pluginsProblem(args: PluginsArgs): string | undefined {
  const plugins = args.command === "plugins";
  const stray = strayFlag(args, plugins);
  if (stray !== undefined) return stray;
  if (!plugins) return undefined;
  const names = args.action === "preview" || args.action === "install";
  if (names && (args.plugin === undefined) === (args.pluginDir === undefined))
    return `plugins ${args.action}: give a plugin or --dir, one of the two`;
  if (INSTALLS.includes(args.action ?? "") && args.confirmHash === undefined)
    return `plugins ${args.action}: missing --confirm-hash <hash> (the hash \`plugins ${args.action === "install" ? "preview" : "preview-update"}\` printed)`;
  if (args.pluginDir !== undefined && args.host !== undefined && !isAbsolute(args.pluginDir))
    return "--dir: on another host the folder must be an absolute path (it is read there, not here)";
  return undefined;
}

const ACTIONS = [
  "list",
  "detail",
  "preview",
  "preview-update",
  "install",
  "update",
  "uninstall",
  "pin",
  "unpin",
  "marketplace-add",
  "marketplace-remove",
  "marketplace-update",
] as const;
/** The verbs whose next word is the plugin, always. */
const PLUGIN_OPERAND = ["detail", "preview-update", "update", "uninstall", "pin", "unpin"];

/** `plugins <verb> ...`: the plugin, source or name the verb names; a preview or an install may give `--dir` instead of a plugin. */
export function readPlugins(args: CliArgs, reader: ArgReader): void {
  args.command = "plugins";
  const action = subAction(reader, ACTIONS, "invalid plugins action");
  args.action = action;
  const optional = reader.peek() !== undefined && !(reader.peek() ?? "").startsWith("--");
  if (PLUGIN_OPERAND.includes(action)) args.plugin = operand(reader, "the plugin");
  else if ((action === "preview" || action === "install") && optional)
    args.plugin = operand(reader, "the plugin");
  else if (action === "marketplace-add")
    args.marketplace = operand(reader, "the marketplace source");
  else if (action === "marketplace-remove")
    args.marketplace = operand(reader, "the marketplace name");
  else if (action === "marketplace-update" && optional)
    args.marketplace = operand(reader, "the marketplace name");
}

/** The flags of the plugin writes, for the parser's table of flags. */
export const PLUGINS_FLAGS: Record<
  string,
  (args: CliArgs, reader: unknown, value: () => string) => void
> = {
  "--confirm-hash": (args, _reader, value) => {
    args.confirmHash = value();
  },
  "--accept-command": (args, _reader, value) => {
    args.acceptCommand = value();
  },
  "--plugin-scope": (args, _reader, value) => {
    args.pluginScope = oneOf("--plugin-scope", value(), ["user", "project", "local"]);
  },
};

/** The `marketplace-*` verbs as `runPluginsCli` takes them, or undefined for another verb. */
function marketplaceCliArgs(args: CliArgs): PluginsCliArgs | undefined {
  const printed = args.json ? { json: true as const } : {};
  const scope = args.pluginScope === undefined ? {} : { scope: args.pluginScope };
  const confirmed = args.confirm ? { confirm: true as const } : {};
  const target = args.marketplace ?? "";
  if (args.action === "marketplace-add")
    return { action: "marketplace-add", source: target, ...scope, ...confirmed, ...printed };
  if (args.action === "marketplace-remove")
    return { action: "marketplace-remove", name: target, ...confirmed, ...printed };
  if (args.action === "marketplace-update")
    return {
      action: "marketplace-update",
      ...(args.marketplace === undefined ? {} : { name: args.marketplace }),
      ...printed,
    };
  return undefined;
}

/** What the person typed for `plugins`, as `runPluginsCli` takes it: a preview names a plugin or a folder, the parser checked which. */
export function pluginsCliArgs(args: CliArgs): PluginsCliArgs {
  const printed = args.json ? { json: true as const } : {};
  const plugin = args.plugin ?? "";
  if (args.action === "list") return { action: "list", ...printed };
  if (args.action === "detail") return { action: "detail", plugin, ...printed };
  if (args.action === "preview-update") return { action: "preview-update", plugin, ...printed };
  const scope = args.pluginScope === undefined ? {} : { scope: args.pluginScope };
  const confirmed = args.confirm ? { confirm: true as const } : {};
  const hash = {
    confirmHash: args.confirmHash ?? "",
    ...(args.acceptCommand === undefined ? {} : { acceptCommand: args.acceptCommand }),
  };
  if (args.action === "install")
    return args.pluginDir === undefined
      ? { action: "install", plugin, ...hash, ...scope, ...printed }
      : { action: "install", dir: args.pluginDir, ...hash, ...scope, ...printed };
  if (args.action === "update") return { action: "update", plugin, ...hash, ...printed };
  if (args.action === "uninstall")
    return { action: "uninstall", plugin, ...scope, ...confirmed, ...printed };
  if (args.action === "pin" || args.action === "unpin")
    return { action: args.action, plugin, ...printed };
  const marketplace = marketplaceCliArgs(args);
  if (marketplace !== undefined) return marketplace;
  if (args.pluginDir !== undefined) return { action: "preview", dir: args.pluginDir, ...printed };
  return { action: "preview", plugin, ...printed };
}
