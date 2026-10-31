/**
 * Phase 26: the Claude Code plugins of this host, driven through the `claude plugin ...` CLI in a
 * child process. Listing and details come from the CLI's JSON and from the plugin folders (read
 * only); installing, updating and removing only happen on an explicit confirmation tied to the
 * hash of the content that was shown, and the CLI is never given `-y`.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { FlightdeckError } from "../errors.ts";
import { isInside } from "../paths.ts";
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
  /** Told of every install, update, removal and marketplace change that landed. */
  record?: (decision: PluginDecision) => void;
}

export interface PluginDecision {
  action:
    | "install"
    | "update"
    | "uninstall"
    | "marketplace-add"
    | "marketplace-remove"
    | "rollback";
  /** The plugin id, or the marketplace name or source. */
  target: string;
  /** The content hash that was confirmed, when there is one. */
  hash?: string;
  at: string;
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

export interface InventoryDiff {
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
function diffOf(from: PluginInventory, to: PluginInventory): InventoryDiff {
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

  /** What an install would bring, read from the plugin's own folder. Nothing is installed. */
  async preview(input: { plugin: string } | { dir: string }): Promise<PluginPreview> {
    if ("dir" in input) {
      const inventory = inspectPlugin(input.dir);
      return {
        plugin: inventory.manifest?.name ?? basename(input.dir),
        ...(inventory.manifest?.version ? { version: inventory.manifest.version } : {}),
        inventory,
        hash: inventory.hash,
        validation: await this.validate(input.dir),
      };
    }
    const dir = await this.sourceDir(input.plugin);
    if (!dir) return { plugin: input.plugin, inventory: null, hash: null, reason: "not-local" };
    const inventory = inspectPlugin(dir);
    return {
      plugin: input.plugin,
      ...(inventory.manifest?.version ? { version: inventory.manifest.version } : {}),
      inventory,
      hash: inventory.hash,
    };
  }

  /** The marketplace's copy against the installed one, after refreshing the marketplace. */
  async previewUpdate(id: string): Promise<UpdatePreview> {
    const { marketplace } = split(id);
    const refreshed = await this.opts.cli.run(["marketplace", "update", marketplace, "--json"]);
    if (refreshed.code !== 0) {
      throw invalid(
        `não deu para atualizar o marketplace ${marketplace}: ${refreshed.stderr.trim()}`,
      );
    }
    const installed = await this.detail(id);
    const next = await this.preview({ plugin: id });
    if (!next.inventory || !installed.inventory) {
      throw invalid(`o conteúdo de ${id} não pode ser mostrado antes de atualizar`);
    }
    return {
      plugin: id,
      from: { version: installed.version, hash: installed.inventory.hash },
      to: { version: next.inventory.manifest?.version ?? "", hash: next.inventory.hash },
      inventory: next.inventory,
      diff: diffOf(installed.inventory, next.inventory),
      unchanged: installed.inventory.hash === next.inventory.hash,
    };
  }

  /** Installs what was shown: the confirmation repeats the hash of the content, and only that. */
  async install(input: {
    plugin?: string;
    dir?: string;
    scope?: "user" | "project" | "local";
    confirmHash: string;
    acceptCommand?: string;
  }): Promise<ChangeResult> {
    const scope = input.scope ?? "user";
    let name: string;
    let args: string[];
    if (input.dir) {
      const shown = await this.preview({ dir: input.dir });
      if (!shown.validation?.success) {
        throw invalid(`o validate recusou o plugin: ${shown.validation?.errors.join("; ") ?? ""}`);
      }
      this.sameContent(shown.hash, input.confirmHash);
      name = shown.plugin;
      args = ["install", name, "--marketplace", input.dir, "--scope", scope, "--json"];
    } else {
      name = input.plugin ?? "";
      const shown = await this.preview({ plugin: name });
      if (shown.hash === null)
        throw invalid(`o conteúdo de ${name} não pode ser mostrado antes de instalar`);
      this.sameContent(shown.hash, input.confirmHash);
      args = ["install", name, "--scope", scope, "--json"];
    }
    const result = await this.change(name, args, input.acceptCommand);
    if (result.outcome === "ok") this.record("install", name, input.confirmHash);
    return result;
  }

  async update(input: {
    plugin: string;
    confirmHash: string;
    acceptCommand?: string;
  }): Promise<ChangeResult> {
    const pin = this.opts.pins.all()[input.plugin];
    if (pin)
      throw invalid(
        `${input.plugin} está fixado na versão ${pin.version}; solte antes de atualizar`,
      );
    const next = await this.previewUpdate(input.plugin);
    if (next.unchanged)
      return { outcome: "unchanged", message: "já está na versão do marketplace" };
    this.sameContent(next.to.hash, input.confirmHash);
    const result = await this.change(
      input.plugin,
      ["update", input.plugin, "--json"],
      input.acceptCommand,
    );
    if (result.outcome === "ok") this.record("update", input.plugin, input.confirmHash);
    return result;
  }

  async uninstall(input: {
    plugin: string;
    scope?: "user" | "project" | "local";
    confirm: boolean;
  }): Promise<ChangeResult> {
    if (!input.confirm) throw invalid("remover pede confirm: true");
    const args = [
      "uninstall",
      input.plugin,
      ...(input.scope ? ["--scope", input.scope] : []),
      "--json",
    ];
    const result = await this.change(input.plugin, args);
    if (result.outcome === "ok") {
      this.opts.pins.delete(input.plugin);
      this.record("uninstall", input.plugin);
    }
    return result;
  }

  async marketplaceAdd(input: {
    source: string;
    scope?: "user" | "project" | "local";
    confirm: boolean;
  }): Promise<ChangeResult> {
    if (!input.confirm) throw invalid("adicionar um marketplace pede confirm: true");
    const args = [
      "marketplace",
      "add",
      input.source,
      ...(input.scope ? ["--scope", input.scope] : []),
      "--json",
    ];
    const result = await this.change(input.source, args);
    if (result.outcome === "ok") this.record("marketplace-add", input.source);
    return result;
  }

  async marketplaceRemove(input: { name: string; confirm: boolean }): Promise<ChangeResult> {
    if (!input.confirm) throw invalid("remover um marketplace pede confirm: true");
    const result = await this.change(input.name, ["marketplace", "remove", input.name, "--json"]);
    if (result.outcome === "ok") this.record("marketplace-remove", input.name);
    return result;
  }

  async marketplaceUpdate(name?: string): Promise<ChangeResult> {
    return this.change(
      name ?? "",
      name ? ["marketplace", "update", name, "--json"] : ["marketplace", "update"],
    );
  }

  private readonly shown = new Map<string, string>();

  private sameContent(shown: string | null, confirmed: string) {
    if (shown !== confirmed) {
      throw invalid("o conteúdo mudou desde que foi mostrado: veja a prévia de novo");
    }
  }

  private record(action: PluginDecision["action"], target: string, hash?: string) {
    this.opts.record?.({
      action,
      target,
      ...(hash ? { hash } : {}),
      at: new Date((this.opts.clock ?? Date.now)()).toISOString(),
    });
  }

  /** The plugin's folder inside its marketplace, or null when it comes from elsewhere. */
  private async sourceDir(id: string): Promise<string | null> {
    const { name, marketplace } = split(id);
    const markets = list(await this.json(["marketplace", "list", "--json"])).filter(isObject);
    const location = text(markets.find((m) => m.name === marketplace)?.installLocation);
    if (!location)
      throw new FlightdeckError("not_found", `o marketplace ${marketplace} não existe`);
    let catalog: unknown;
    try {
      catalog = JSON.parse(
        readFileSync(join(location, ".claude-plugin", "marketplace.json"), "utf8"),
      );
    } catch {
      throw invalid(`o catálogo do marketplace ${marketplace} não pôde ser lido`);
    }
    const entry = list(isObject(catalog) ? catalog.plugins : [])
      .filter(isObject)
      .find((p) => p.name === name);
    if (!entry) throw new FlightdeckError("not_found", `${id} não existe no marketplace`);
    const source = text(entry.source);
    if (!source?.startsWith("./")) return null;
    const dir = resolve(location, source);
    if (!existsSync(dir) || !isInside(realpathSync.native(location), realpathSync.native(dir)))
      return null;
    return dir;
  }

  /** `claude plugin validate`: whether it passed and the errors of the manifest. */
  private async validate(dir: string): Promise<{ success: boolean; errors: string[] }> {
    const result = await this.opts.cli.run(["validate", dir, "--json"]);
    try {
      const report = JSON.parse(result.stdout) as Json;
      const manifest = isObject(report.manifest) ? report.manifest : {};
      const errors = list(manifest.errors)
        .filter(isObject)
        .map((e) => `${text(e.path) ?? ""}: ${text(e.message) ?? ""}`);
      return { success: report.success === true && result.code === 0, errors };
    } catch {
      return { success: false, errors: [result.stderr.trim() || "o validate não respondeu"] };
    }
  }

  /**
   * Runs a change. A command the marketplace wants shown comes back to the caller; only its own
   * sha256, sent back by the caller after the person saw it, is passed on. `-y` never is.
   */
  private async change(key: string, args: string[], acceptCommand?: string): Promise<ChangeResult> {
    if (acceptCommand !== undefined && this.shown.get(key) !== acceptCommand) {
      throw invalid("só se aceita o comando que foi mostrado: peça de novo para ver");
    }
    const sent = acceptCommand ? [...args, "--accept-command", acceptCommand] : args;
    const result = await this.opts.cli.run(sent);
    const line = result.stdout.trim().split(/\r?\n/).at(-1) ?? "";
    let parsed: Json | null = null;
    try {
      const json = JSON.parse(line);
      parsed = isObject(json) ? json : null;
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed.outcome !== "string") {
      return result.code === 0
        ? { outcome: "ok", message: result.stdout.trim() }
        : { outcome: "failed", message: result.stderr.trim() || `código ${result.code}` };
    }
    const message = text(parsed.message) ?? "";
    const command = isObject(parsed.shownCommand) ? parsed.shownCommand : null;
    if (parsed.outcome !== "ok" && command && text(command.sha256)) {
      const sha256 = text(command.sha256) as string;
      this.shown.set(key, sha256);
      return {
        outcome: "needs-command-confirmation",
        message,
        shownCommand: {
          ...(text(command.command) ? { command: text(command.command) as string } : {}),
          ...(text(command.plugin) ? { plugin: text(command.plugin) as string } : {}),
          sha256,
        },
      };
    }
    return { outcome: parsed.outcome === "ok" ? "ok" : "failed", message };
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

/** A recorder that appends each decision as a line of JSON to `path`. */
export function pluginDecisionLog(path: string): (decision: PluginDecision) => void {
  return (decision) => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(decision)}\n`);
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
