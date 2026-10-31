/**
 * Phase 26: the Claude Code plugins of this host, driven through the `claude plugin ...` CLI in a
 * child process. Listing and details come from the CLI's JSON and from the plugin folders (read
 * only); installing, updating and removing only happen on an explicit confirmation tied to the
 * hash of the content that was shown, and the CLI is never given `-y`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { FlightdeckError } from "../errors.ts";
import { whichOnPath } from "../which.ts";
import { inspectPlugin, type PluginInventory } from "./inventory.ts";

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

const invalid = (message: string) => new FlightdeckError("invalid_state", message);

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The id `name@marketplace` split at its last `@`. */
function split(id: string): { name: string; marketplace: string } {
  const at = id.lastIndexOf("@");
  return at < 0
    ? { name: id, marketplace: "" }
    : { name: id.slice(0, at), marketplace: id.slice(at + 1) };
}

export class Plugins {
  constructor(private readonly opts: PluginsOptions) {}

  async list(): Promise<PluginList> {
    const listed = await this.json(["list", "--json", "--available"]);
    const markets = await this.json(["marketplace", "list", "--json"]);
    const pins = this.opts.pins.all();
    const installedRaw = Array.isArray(listed)
      ? listed
      : isObject(listed)
        ? list(listed.installed)
        : [];
    const availableRaw = isObject(listed) ? list(listed.available) : [];
    return {
      installed: installedRaw.filter(isObject).map((item) => this.installed(item, pins)),
      available: availableRaw.filter(isObject).map((item) => ({
        id: text(item.pluginId) ?? "",
        name: text(item.name) ?? "",
        marketplace: text(item.marketplaceName) ?? "",
        ...(text(item.description) ? { description: text(item.description) as string } : {}),
        ...(text(item.version) ? { version: text(item.version) as string } : {}),
      })),
      marketplaces: list(markets)
        .filter(isObject)
        .map((item) => {
          const origin = text(item.repo) ?? text(item.url) ?? text(item.path);
          return {
            name: text(item.name) ?? "",
            source: text(item.source) ?? "",
            ...(origin ? { origin } : {}),
            ...(text(item.installLocation)
              ? { location: text(item.installLocation) as string }
              : {}),
          };
        }),
    };
  }

  /** One installed plugin, with what it installs. */
  async detail(id: string): Promise<InstalledPlugin> {
    const found = (await this.list()).installed.find((plugin) => plugin.id === id);
    if (!found) throw new FlightdeckError("not_found", `${id} não está instalado`);
    return found;
  }

  /** Fixes the installed version, or lets it go. */
  async pin(id: string, pinned: boolean): Promise<InstalledPlugin> {
    const found = await this.detail(id);
    if (!pinned) {
      this.opts.pins.delete(id);
      return { ...found, pinned: null };
    }
    const pin: Pin = {
      version: found.version,
      hash: found.inventory?.hash ?? "",
      at: new Date((this.opts.clock ?? Date.now)()).toISOString(),
    };
    this.opts.pins.set(id, pin);
    return { ...found, pinned: pin };
  }

  private installed(item: Json, pins: Record<string, Pin>): InstalledPlugin {
    const id = text(item.id) ?? "";
    const path = text(item.readFromFolder) ?? text(item.installPath) ?? "";
    let inventory: PluginInventory | null = null;
    try {
      inventory = inspectPlugin(path);
    } catch {
      // A folder that is gone or too big shows no inventory; the CLI's own errors still show.
    }
    return {
      id,
      ...split(id),
      version: text(item.version) ?? "",
      scope: text(item.scope) ?? "",
      enabled: item.enabled === true,
      path,
      pinned: pins[id] ?? null,
      inventory,
      errors: list(item.errors).map(String),
    };
  }

  /** Runs the CLI and parses its stdout as JSON; the reason when it fails. */
  private async json(args: string[]): Promise<unknown> {
    const result = await this.opts.cli.run(args);
    if (result.code !== 0) {
      throw invalid(
        `claude plugin ${args[0]} falhou: ${result.stderr.trim() || `código ${result.code}`}`,
      );
    }
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw invalid(`claude plugin ${args[0]} não devolveu JSON`);
    }
  }
}

/** The CLI found on PATH (`claude plugin ...`), with the environment of the daemon. */
export function claudeCli(
  options: { timeoutMs?: number; executable?: () => string | null } = {},
): PluginCli {
  return {
    run: async (args) => {
      const executable = (options.executable ?? (() => whichOnPath("claude")))();
      if (!executable) throw invalid("o claude não foi encontrado no PATH");
      const proc = Bun.spawn([executable, "plugin", ...args], {
        env: process.env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: options.timeoutMs ?? 120_000,
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { code, stdout, stderr };
    },
  };
}

/** Pins kept in a JSON file; one that cannot be read is no pin at all. */
export function filePins(path: string): PinStore {
  const read = (): Record<string, Pin> => {
    try {
      const data = JSON.parse(readFileSync(path, "utf8"));
      return isObject(data) ? (data as Record<string, Pin>) : {};
    } catch {
      return {};
    }
  };
  const write = (pins: Record<string, Pin>) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(pins, null, 2));
  };
  return {
    all: read,
    set: (id, pin) => write({ ...read(), [id]: pin }),
    delete: (id) => {
      const { [id]: _gone, ...rest } = read();
      write(rest);
    },
  };
}
