/**
 * Phase 26: the Claude Code plugins of this host, driven through the `claude plugin ...` CLI in a
 * child process. Listing and details come from the CLI's JSON and from the plugin folders (read
 * only); installing, updating and removing only happen on an explicit confirmation tied to the
 * hash of the content that was shown, and the CLI is never given `-y`.
 */
import { basename, join, resolve } from "node:path";
import { FlightdeckError, isInside, parseJsonWith } from "../kernel/index.ts";
import { diskPluginFiles } from "./adapters/plugin-files.ts";
import { AnyJson, JsonObject } from "./domain/json-reads.ts";
import {
  arg,
  invalid,
  isObject,
  type Json,
  lastJsonLine,
  list,
  type PluginScope,
  shownCommandOf,
  split,
  text,
} from "./domain/plugin-json.ts";
import type { PluginInventory } from "./domain/plugin-manifest.ts";
import {
  type ChangeResult,
  diffOf,
  type InstalledPlugin,
  type PluginList,
  type PluginPreview,
  type UpdatePreview,
} from "./domain/results.ts";
import { inspectPlugin } from "./inventory.ts";
import type { CliResult, Pin, PluginDecision, PluginFiles, PluginsOptions } from "./ports.ts";

export class Plugins {
  private readonly files: PluginFiles;

  constructor(private readonly opts: PluginsOptions) {
    this.files = opts.files ?? diskPluginFiles;
  }

  private closed = false;

  /** Stops the work: a call in flight finishes, but no more CLI calls start. */
  close(): void {
    this.closed = true;
  }

  async list(): Promise<PluginList> {
    const listed = await this.json(["list", "--json", "--available"]);
    const markets = await this.json(["marketplace", "list", "--json"]);
    const pins = await this.opts.pins.all();
    const fromObject = list(isObject(listed) ? listed.installed : []);
    const installedRaw = Array.isArray(listed) ? listed : fromObject;
    const availableRaw = isObject(listed) ? list(listed.available) : [];
    return {
      installed: await Promise.all(
        installedRaw.filter(isObject).map((item) => this.installed(item, pins)),
      ),
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
    arg(id);
    const found = (await this.list()).installed.find((plugin) => plugin.id === id);
    if (!found)
      throw new FlightdeckError("not_found", `${id} is not installed`, "plugin_not_installed", {
        id,
      });
    return found;
  }

  /** Fixes the installed version, or lets it go. */
  async pin(id: string, pinned: boolean): Promise<InstalledPlugin> {
    arg(id);
    const found = await this.detail(id);
    if (!pinned) {
      await this.opts.pins.delete(id);
      return { ...found, pinned: null };
    }
    const pin: Pin = {
      version: found.version,
      hash: found.inventory?.hash ?? "",
      at: new Date((this.opts.clock ?? Date.now)()).toISOString(),
    };
    await this.opts.pins.set(id, pin);
    return { ...found, pinned: pin };
  }

  /** What an install would bring, read from the plugin's own folder. Nothing is installed. */
  async preview(input: { plugin: string } | { dir: string }): Promise<PluginPreview> {
    arg("dir" in input ? input.dir : input.plugin);
    if ("dir" in input) {
      const inventory = await inspectPlugin(input.dir);
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
    const inventory = await inspectPlugin(dir);
    return {
      plugin: input.plugin,
      ...(inventory.manifest?.version ? { version: inventory.manifest.version } : {}),
      inventory,
      hash: inventory.hash,
    };
  }

  /** The marketplace's copy against the installed one, after refreshing the marketplace. */
  async previewUpdate(id: string): Promise<UpdatePreview> {
    arg(id);
    const { marketplace } = split(id);
    const refreshed = await this.cli(["marketplace", "update", marketplace, "--json"]);
    if (refreshed.code !== 0) {
      throw invalid(
        `could not update the marketplace ${marketplace}: ${refreshed.stderr.trim()}`,
        "marketplace_update_failed",
        { marketplace, why: refreshed.stderr.trim() },
      );
    }
    const installed = await this.detail(id);
    const next = await this.preview({ plugin: id });
    if (!next.inventory || !installed.inventory) {
      throw invalid(
        `the content of ${id} cannot be shown before updating`,
        "plugin_preview_unavailable_update",
        { id },
      );
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
    scope?: PluginScope;
    confirmHash: string;
    acceptCommand?: string;
  }): Promise<ChangeResult> {
    arg(input.plugin ?? input.dir ?? "");
    const scope = input.scope ?? "user";
    let name: string;
    let args: string[];
    if (input.dir) {
      const shown = await this.preview({ dir: input.dir });
      if (!shown.validation?.success) {
        const errors = shown.validation?.errors.join("; ") ?? "";
        throw invalid(`validate refused the plugin: ${errors}`, "plugin_validate_refused", {
          errors,
        });
      }
      this.sameContent(shown.hash, input.confirmHash);
      name = shown.plugin;
      args = ["install", name, "--marketplace", input.dir, "--scope", scope, "--json"];
    } else {
      name = input.plugin ?? "";
      const shown = await this.preview({ plugin: name });
      if (shown.hash === null)
        throw invalid(
          `the content of ${name} cannot be shown before installing`,
          "plugin_preview_unavailable_install",
          { name },
        );
      this.sameContent(shown.hash, input.confirmHash);
      args = ["install", name, "--scope", scope, "--json"];
    }
    const result = await this.change(name, args, input.acceptCommand);
    if (result.outcome !== "ok") return result;
    const checked = await this.verify(name, scope, input.confirmHash);
    if (checked) return checked;
    await this.record("install", name, input.confirmHash);
    return result;
  }

  async update(input: {
    plugin: string;
    confirmHash: string;
    acceptCommand?: string;
  }): Promise<ChangeResult> {
    arg(input.plugin);
    const pin = (await this.opts.pins.all())[input.plugin];
    if (pin)
      throw invalid(
        `${input.plugin} is pinned to version ${pin.version}; unpin it before updating`,
        "plugin_pinned",
        { id: input.plugin, version: pin.version },
      );
    const next = await this.previewUpdate(input.plugin);
    if (next.unchanged)
      return { outcome: "unchanged", message: "already at the marketplace version" };
    this.sameContent(next.to.hash, input.confirmHash);
    const result = await this.change(
      input.plugin,
      ["update", input.plugin, "--json"],
      input.acceptCommand,
    );
    if (result.outcome !== "ok") return result;
    const checked = await this.verify(input.plugin, "user", input.confirmHash);
    if (checked) return checked;
    await this.record("update", input.plugin, input.confirmHash);
    return result;
  }

  async uninstall(input: {
    plugin: string;
    scope?: PluginScope;
    confirm: boolean;
  }): Promise<ChangeResult> {
    arg(input.plugin);
    if (!input.confirm) throw invalid("removing needs confirm: true", "plugin_remove_confirm");
    const args = [
      "uninstall",
      input.plugin,
      ...(input.scope ? ["--scope", input.scope] : []),
      "--json",
    ];
    const result = await this.change(input.plugin, args);
    if (result.outcome === "ok") {
      await this.opts.pins.delete(input.plugin);
      await this.record("uninstall", input.plugin);
    }
    return result;
  }

  async marketplaceAdd(input: {
    source: string;
    scope?: PluginScope;
    confirm: boolean;
  }): Promise<ChangeResult> {
    arg(input.source);
    if (!input.confirm)
      throw invalid("adding a marketplace needs confirm: true", "marketplace_add_confirm");
    const args = [
      "marketplace",
      "add",
      input.source,
      ...(input.scope ? ["--scope", input.scope] : []),
      "--json",
    ];
    const result = await this.change(input.source, args);
    if (result.outcome === "ok") await this.record("marketplace-add", input.source);
    return result;
  }

  async marketplaceRemove(input: { name: string; confirm: boolean }): Promise<ChangeResult> {
    arg(input.name);
    if (!input.confirm)
      throw invalid("removing a marketplace needs confirm: true", "marketplace_remove_confirm");
    const result = await this.change(input.name, ["marketplace", "remove", input.name, "--json"]);
    if (result.outcome === "ok") await this.record("marketplace-remove", input.name);
    return result;
  }

  async marketplaceUpdate(name?: string): Promise<ChangeResult> {
    if (name) arg(name);
    return this.change(
      name ?? "",
      name ? ["marketplace", "update", name, "--json"] : ["marketplace", "update"],
    );
  }

  private readonly shown = new Map<string, string>();

  /**
   * The CLI fetches on its own, so what it left may not be what was shown: the installed folder
   * is hashed again, and anything else than the confirmed content is uninstalled at once.
   * Null when it matches.
   */
  private async verify(
    target: string,
    scope: string,
    confirmHash: string,
  ): Promise<ChangeResult | null> {
    const found = (await this.list()).installed.find(
      (p) => p.id === target || (!target.includes("@") && p.name === target),
    );
    if (!found?.inventory) {
      return {
        outcome: "failed",
        message: `could not check the installed content of ${target}`,
      };
    }
    if (found.inventory.hash === confirmHash) return null;
    const undone = await this.change(found.id, [
      "uninstall",
      found.id,
      "--scope",
      found.scope || scope,
      "--json",
    ]);
    await this.record("rollback", found.id, confirmHash);
    return {
      outcome: "rolled-back",
      message: `the installed content of ${found.id} differs from what was shown; the plugin was removed (${undone.outcome})`,
    };
  }

  private sameContent(shown: string | null, confirmed: string) {
    if (shown !== confirmed) {
      throw invalid(
        "the content changed since it was shown: view the preview again",
        "plugin_content_changed",
      );
    }
  }

  private async record(
    action: PluginDecision["action"],
    target: string,
    hash?: string,
  ): Promise<void> {
    await this.opts.record?.({
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
      throw new FlightdeckError(
        "not_found",
        `the marketplace ${marketplace} does not exist`,
        "marketplace_missing",
        { marketplace },
      );
    let catalog: unknown;
    try {
      catalog = parseJsonWith(AnyJson, await this.files.readCatalog(location));
    } catch {
      throw invalid(
        `the catalog of the marketplace ${marketplace} could not be read`,
        "marketplace_catalog_unreadable",
        { marketplace },
      );
    }
    const entry = list(isObject(catalog) ? catalog.plugins : [])
      .filter(isObject)
      .find((p) => p.name === name);
    if (!entry)
      throw new FlightdeckError(
        "not_found",
        `${id} does not exist in the marketplace`,
        "plugin_not_in_marketplace",
        { id },
      );
    const source = text(entry.source);
    if (!source?.startsWith("./")) return null;
    const dir = resolve(location, source);
    // The catalog was just read from `location`, so it is there; the plugin's folder may not be.
    const [realLocation, realDir] = await Promise.all([
      this.files.realpath(location),
      this.files.realpath(dir).catch(() => null),
    ]);
    if (!realDir || !isInside(realLocation, realDir)) return null;
    return dir;
  }

  /** `claude plugin validate`: whether it passed and the errors of the manifest. */
  private async validate(dir: string): Promise<{ success: boolean; errors: string[] }> {
    const result = await this.cli(["validate", dir, "--json"]);
    try {
      const report = parseJsonWith(JsonObject, result.stdout);
      const manifest = isObject(report.manifest) ? report.manifest : {};
      const errors = list(manifest.errors)
        .filter(isObject)
        .map((e) => `${text(e.path) ?? ""}: ${text(e.message) ?? ""}`);
      return { success: report.success === true && result.code === 0, errors };
    } catch {
      return { success: false, errors: [result.stderr.trim() || "validate did not answer"] };
    }
  }

  /**
   * Runs a change. A command the marketplace wants shown comes back to the caller; only its own
   * sha256, sent back by the caller after the person saw it, is passed on. `-y` never is.
   */
  private async change(key: string, args: string[], acceptCommand?: string): Promise<ChangeResult> {
    if (acceptCommand !== undefined && this.shown.get(key) !== acceptCommand) {
      throw invalid(
        "only the command that was shown is accepted: ask to see it again",
        "plugin_command_mismatch",
      );
    }
    const sent = acceptCommand ? [...args, "--accept-command", acceptCommand] : args;
    const result = await this.cli(sent);
    const parsed = lastJsonLine(result.stdout);
    if (!parsed || typeof parsed.outcome !== "string") {
      return result.code === 0
        ? { outcome: "ok", message: result.stdout.trim() }
        : { outcome: "failed", message: result.stderr.trim() || `code ${result.code}` };
    }
    const message = text(parsed.message) ?? "";
    const shown = parsed.outcome !== "ok" ? shownCommandOf(parsed.shownCommand) : null;
    if (shown) {
      this.shown.set(key, shown.sha256);
      return { outcome: "needs-command-confirmation", message, shownCommand: shown };
    }
    return { outcome: parsed.outcome === "ok" ? "ok" : "failed", message };
  }

  private async installed(item: Json, pins: Record<string, Pin>): Promise<InstalledPlugin> {
    const id = text(item.id) ?? "";
    const path = text(item.readFromFolder) ?? text(item.installPath) ?? "";
    let inventory: PluginInventory | null = null;
    try {
      inventory = await inspectPlugin(path);
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

  /** Runs the CLI unless the manager was closed: nothing starts after a stop. */
  private cli(args: string[]): Promise<CliResult> {
    if (this.closed) throw invalid("the plugin manager was stopped", "plugins_stopped");
    return this.opts.cli.run(args);
  }

  /** Runs the CLI and parses its stdout as JSON; the reason when it fails. */
  private async json(args: string[]): Promise<unknown> {
    const result = await this.cli(args);
    if (result.code !== 0) {
      const why = result.stderr.trim() || `code ${result.code}`;
      throw invalid(`claude plugin ${args[0]} failed: ${why}`, "plugin_cli_failed", {
        command: args[0] ?? "",
        why,
      });
    }
    try {
      return parseJsonWith(AnyJson, result.stdout);
    } catch {
      throw invalid(`claude plugin ${args[0]} did not return JSON`, "plugin_cli_not_json", {
        command: args[0] ?? "",
      });
    }
  }
}
