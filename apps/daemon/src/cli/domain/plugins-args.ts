/**
 * Issue #3516: what the `plugins` verbs of the CLI take, checked before anything is sent. The parser in
 * `args.ts` adds the usage text to the problem this names.
 */
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

/** The parsed arguments this check reads: `CliArgs` fits it. */
export interface PluginsArgs {
  command: string;
  action?: string;
  plugin?: string;
  pluginDir?: string;
}

/** What is wrong with the `plugins` words and flags: `--dir` outside a preview, or a preview that names no plugin or two. */
export function pluginsProblem(args: PluginsArgs): string | undefined {
  const preview = args.command === "plugins" && args.action === "preview";
  if (args.pluginDir !== undefined && !preview)
    return "--dir: this flag only applies to flightdeckd plugins preview";
  if (preview && (args.plugin === undefined) === (args.pluginDir === undefined))
    return "plugins preview: give a plugin or --dir, one of the two";
  return undefined;
}

/** `plugins <list|detail|preview|preview-update>`: the plugin that `detail` and `preview-update` always name, and a `preview` may (or gives `--dir`). */
export function readPlugins(args: CliArgs, reader: ArgReader): void {
  args.command = "plugins";
  const action = subAction(
    reader,
    ["list", "detail", "preview", "preview-update"] as const,
    "invalid plugins action",
  );
  args.action = action;
  const word = reader.peek();
  if (action === "detail" || action === "preview-update")
    args.plugin = operand(reader, "the plugin");
  if (action === "preview" && word !== undefined && !word.startsWith("--"))
    args.plugin = operand(reader, "the plugin");
}
