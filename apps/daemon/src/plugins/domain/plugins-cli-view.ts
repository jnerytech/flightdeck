/**
 * Issue #3516: what `flightdeckd plugins list|detail|preview|preview-update` say, as pure rules over the
 * daemon's answers. The daemon calls and the exit codes stay in `plugins/plugins-cli.ts`.
 */
import type {
  InstalledPlugin,
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
  | (Printed & { action: "detail" | "preview-update"; plugin: string })
  | (Printed & { action: "preview"; plugin: string })
  | (Printed & { action: "preview"; dir: string });

export function listLines(_list: PluginList): string[] {
  return [];
}

export function detailLines(_plugin: InstalledPlugin): string[] {
  return [];
}

export function previewLines(_preview: PluginPreview): string[] {
  return [];
}

export function updateLines(_update: PluginUpdatePreview): string[] {
  return [];
}
