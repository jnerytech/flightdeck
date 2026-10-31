/**
 * Phase 26: the Claude Code plugins of this host, driven through the `claude plugin ...` CLI in a
 * child process. Listing and details come from the CLI's JSON and from the plugin folders (read
 * only); installing, updating and removing only happen on an explicit confirmation tied to the
 * hash of the content that was shown, and the CLI is never given `-y`.
 */
import type { PluginInventory } from "./inventory.ts";

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `claude plugin <args>`. */
export interface PluginCli {
  run(args: string[]): Promise<CliResult>;
}

/** A version the person fixed: updates are refused until it is released. */
export interface Pin {
  version: string;
  /** The content hash of the plugin when it was pinned. */
  hash: string;
  at: string;
}

export interface PinStore {
  all(): Record<string, Pin>;
  set(id: string, pin: Pin): void;
  delete(id: string): void;
}

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

export interface AvailablePlugin {
  id: string;
  name: string;
  marketplace: string;
  description?: string;
  version?: string;
}

export interface MarketplaceInfo {
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

export interface PluginsOptions {
  cli: PluginCli;
  pins: PinStore;
  clock?: () => number;
}

export class Plugins {
  constructor(private readonly opts: PluginsOptions) {}

  async list(): Promise<PluginList> {
    void this.opts;
    return { installed: [], available: [], marketplaces: [] };
  }

  /** One installed plugin, with what it installs. */
  async detail(_id: string): Promise<InstalledPlugin> {
    return {
      id: "",
      name: "",
      marketplace: "",
      version: "",
      scope: "",
      enabled: false,
      path: "",
      pinned: null,
      inventory: null,
      errors: [],
    };
  }

  /** Fixes the installed version, or lets it go. */
  async pin(_id: string, _pinned: boolean): Promise<InstalledPlugin> {
    return this.detail(_id);
  }
}

/** The CLI found on PATH (`claude plugin ...`), with the environment of the daemon. */
export function claudeCli(
  _options: { timeoutMs?: number; executable?: () => string | null } = {},
): PluginCli {
  return { run: async () => ({ code: -1, stdout: "", stderr: "" }) };
}

/** Pins kept in a JSON file. */
export function filePins(_path: string): PinStore {
  return { all: () => ({}), set: () => {}, delete: () => {} };
}
