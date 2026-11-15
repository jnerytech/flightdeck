import type { Pin } from "../ports.ts";
import type { PluginInventory } from "./plugin-manifest.ts";

/** What the plugin manager answers: the lists, the previews and the outcome of a change (#1589). */

export interface InstalledPlugin {
  id: string;
  name: string;
  marketplace: string;
  version: string;
  scope: string;
  enabled: boolean;
  /** Where the plugin's files are, as the CLI reports. */
  path: string;
  pinned: Pin | null;
  /** Null when the folder could not be read. */
  inventory: PluginInventory | null;
  errors: string[];
}

interface AvailablePlugin {
  id: string;
  name: string;
  marketplace: string;
  description?: string;
  version?: string;
}

interface MarketplaceInfo {
  name: string;
  source: string;
  /** The repository, URL or path the marketplace came from. */
  origin?: string;
  location?: string;
}

export interface PluginList {
  installed: InstalledPlugin[];
  available: AvailablePlugin[];
  marketplaces: MarketplaceInfo[];
}

/** What the person sees before an install or update, and the hash the confirmation must repeat. */
export interface PluginPreview {
  plugin: string;
  version?: string;
  /** Null when the content cannot be shown (a plugin fetched from another repository). */
  inventory: PluginInventory | null;
  hash: string | null;
  reason?: "not-local";
  /** The CLI's validation of a local plugin folder. */
  validation?: { success: boolean; errors: string[] };
}

interface InventoryDiff {
  hooks: { added: string[]; removed: string[] };
  monitors: { added: string[]; removed: string[] };
  skills: { added: string[]; removed: string[] };
  agents: { added: string[]; removed: string[] };
  commands: { added: string[]; removed: string[] };
  mcpServers: { added: string[]; removed: string[] };
}

export interface UpdatePreview {
  plugin: string;
  from: { version: string; hash: string };
  to: { version: string; hash: string };
  inventory: PluginInventory;
  diff: InventoryDiff;
  /** The marketplace has the same content already installed. */
  unchanged: boolean;
}

/** What a change that went to the CLI came to. */
export interface ChangeResult {
  outcome: "ok" | "failed" | "unchanged" | "needs-command-confirmation" | "rolled-back";
  message: string;
  /** A command the marketplace declares, to be shown to the person: only its `sha256` accepts it. */
  shownCommand?: { command?: string; plugin?: string; sha256: string };
}

/** Added and removed lines of each kind of component between two inventories. */
export function diffOf(from: PluginInventory, to: PluginInventory): InventoryDiff {
  const delta = (before: string[], after: string[]) => ({
    added: after.filter((x) => !before.includes(x)),
    removed: before.filter((x) => !after.includes(x)),
  });
  const hooks = (i: PluginInventory) => i.hooks.map((h) => `${h.event}: ${h.command ?? h.type}`);
  return {
    hooks: delta(hooks(from), hooks(to)),
    monitors: delta(
      from.monitors.map((m) => m.name),
      to.monitors.map((m) => m.name),
    ),
    skills: delta(from.skills, to.skills),
    agents: delta(from.agents, to.agents),
    commands: delta(from.commands, to.commands),
    mcpServers: delta(
      from.mcpServers.map((m) => m.name),
      to.mcpServers.map((m) => m.name),
    ),
  };
}
