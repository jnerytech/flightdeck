/**
 * Phase 26: what a plugin would install, read from its folder without running anything: the
 * manifest, the hooks and the events they listen to, the monitors, skills, agents, commands and
 * MCP servers, plus a hash of the whole content. A plugin runs code on the machine, so the person
 * sees this before any install or update, and the hash ties the confirmation to what was shown.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { frontmatter } from "../agentcfg/files.ts";
import { FlightdeckError } from "../errors.ts";
import { isInside } from "../paths.ts";

/** Hook events that can decide for the user; a plugin listening to them gets the attention mark. */
export const SENSITIVE_EVENTS = ["PreToolUse", "PermissionRequest"];

export interface PluginHook {
  event: string;
  matcher?: string;
  type: string;
  /** The command or URL the hook runs, as written. Shown, never executed. */
  command?: string;
  /** Listens to an event that can allow or deny a tool use. */
  sensitive: boolean;
}

export interface PluginMonitor {
  name: string;
  command: string;
  description: string;
  when: string;
}

export interface PluginMcpServer {
  name: string;
  transport: string;
  /** The command (stdio) or the URL (remote), as written. */
  target: string;
}

export interface PluginInventory {
  manifest: { name?: string; version?: string; description?: string; author?: string } | null;
  hooks: PluginHook[];
  monitors: PluginMonitor[];
  skills: string[];
  agents: string[];
  commands: string[];
  mcpServers: PluginMcpServer[];
  /** Some hook listens to a sensitive event. */
  attention: boolean;
  /** sha256 over every file's path and bytes, in path order; `.git` is left out. */
  hash: string;
  files: number;
  bytes: number;
  /** What could not be read or was refused (a path outside the plugin, a broken file). */
  problems: string[];
}

const MAX_FILES = 5000;
const MAX_BYTES = 50 * 1024 * 1024;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const asList = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/** Every regular file under `root` (links are not followed, `.git` is skipped), sorted by path. */
function filesUnder(root: string): { files: string[]; links: string[] } {
  const files: string[] = [];
  const links: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isSymbolicLink()) links.push(path);
      else if (entry.isDirectory()) {
        if (entry.name !== ".git") walk(join(dir, entry.name), path);
      } else if (entry.isFile()) files.push(path);
      if (files.length > MAX_FILES) {
        throw new FlightdeckError(
          "bad_request",
          `plugin com arquivos demais (mais de ${MAX_FILES})`,
        );
      }
    }
  };
  walk(root, "");
  return {
    files: [...files].sort((a, b) => (a < b ? -1 : Number(a > b))),
    links: [...links].sort((a, b) => (a < b ? -1 : Number(a > b))),
  };
}

export function inspectPlugin(dir: string): PluginInventory {
  if (!existsSync(dir)) throw new FlightdeckError("not_found", `${dir} não existe`);
  const root = realpathSync.native(resolve(dir));
  const problems: string[] = [];

  // The hash: every file's path, size and bytes in path order; a link counts by its name and target.
  const listing = filesUnder(root);
  const paths = listing.files;
  const hash = createHash("sha256");
  let bytes = 0;
  for (const path of paths) {
    const content = readFileSync(join(root, path));
    bytes += content.length;
    if (bytes > MAX_BYTES) throw new FlightdeckError("bad_request", "plugin grande demais");
    hash.update(`F\0${path}\0${content.length}\0`).update(content).update("\0");
  }
  for (const link of listing.links) {
    hash.update(`L\0${link}\0${readlinkSync(join(root, link))}\0`);
  }

  /** A path the manifest names, refused when it leaves the plugin; the real path or null. */
  const inside = (key: string, rel: string): string | null => {
    const target = resolve(root, rel);
    const real = existsSync(target) ? realpathSync.native(target) : target;
    if (!isInside(root, real)) {
      problems.push(`${key}: caminho fora do plugin: ${rel}`);
      return null;
    }
    return existsSync(real) ? real : null;
  };
  const readJson = (path: string, label: string): unknown => {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      problems.push(`${label}: não é um JSON válido`);
      return undefined;
    }
  };

  const manifestPath = join(root, ".claude-plugin", "plugin.json");
  const raw = existsSync(manifestPath) ? readJson(manifestPath, "plugin.json") : undefined;
  const manifestJson = isObject(raw) ? raw : null;
  const author = manifestJson?.author;
  const manifest = manifestJson
    ? {
        ...(text(manifestJson.name) ? { name: text(manifestJson.name) as string } : {}),
        ...(text(manifestJson.version) ? { version: text(manifestJson.version) as string } : {}),
        ...(text(manifestJson.description)
          ? { description: text(manifestJson.description) as string }
          : {}),
        ...(text(isObject(author) ? author.name : author)
          ? { author: text(isObject(author) ? author.name : author) as string }
          : {}),
      }
    : null;

  // Hooks: hooks/hooks.json first, then what the manifest adds (a file, an inline map, or a list).
  const hooks: PluginHook[] = [];
  const addHooks = (events: unknown) => {
    if (!isObject(events)) return;
    for (const [event, groups] of Object.entries(events)) {
      for (const group of asList(groups as unknown)) {
        if (!isObject(group)) continue;
        for (const hook of asList(group.hooks as unknown)) {
          if (!isObject(hook)) continue;
          const args = Array.isArray(hook.args) ? hook.args.map(String) : [];
          const command = [text(hook.command) ?? text(hook.url) ?? text(hook.prompt), ...args]
            .filter((part): part is string => part !== undefined)
            .join(" ");
          hooks.push({
            event,
            ...(text(group.matcher) ? { matcher: text(group.matcher) as string } : {}),
            type: text(hook.type) ?? "command",
            ...(command ? { command } : {}),
            sensitive: SENSITIVE_EVENTS.includes(event),
          });
        }
      }
    }
  };
  const addHooksFile = (path: string, label: string) => {
    const file = readJson(path, label);
    addHooks(isObject(file) ? file.hooks : undefined);
  };
  if (existsSync(join(root, "hooks", "hooks.json"))) {
    addHooksFile(join(root, "hooks", "hooks.json"), "hooks/hooks.json");
  }
  for (const item of asList(manifestJson?.hooks as unknown)) {
    if (typeof item === "string") {
      const path = inside("hooks", item);
      if (path) addHooksFile(path, item);
    } else addHooks(item);
  }

  // Monitors: the manifest's list or file, else monitors/monitors.json.
  const monitors: PluginMonitor[] = [];
  const addMonitors = (list: unknown) => {
    for (const item of asList(list as unknown)) {
      if (!isObject(item) || !text(item.name) || !text(item.command)) continue;
      monitors.push({
        name: text(item.name) as string,
        command: text(item.command) as string,
        description: text(item.description) ?? "",
        when: text(item.when) ?? "always",
      });
    }
  };
  const experimental = isObject(manifestJson?.experimental) ? manifestJson?.experimental : null;
  const declared = experimental?.monitors ?? manifestJson?.monitors;
  if (declared === undefined) {
    const file = join(root, "monitors", "monitors.json");
    if (existsSync(file)) addMonitors(readJson(file, "monitors/monitors.json"));
  } else if (typeof declared === "string") {
    const path = inside("monitors", declared);
    if (path) addMonitors(readJson(path, declared));
  } else addMonitors(declared);

  // Skills: skills/ and the folders the manifest adds. A link is never followed.
  const skills = new Set<string>();
  const addSkills = (base: string) => {
    if (!existsSync(base)) return;
    const own = join(base, "SKILL.md");
    if (existsSync(own) && !lstatSync(own).isSymbolicLink())
      skills.add(skillName(own, basename(base)));
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const file = join(base, entry.name, "SKILL.md");
      if (entry.isDirectory() && existsSync(file) && !lstatSync(file).isSymbolicLink()) {
        skills.add(skillName(file, entry.name));
      }
    }
  };
  addSkills(join(root, "skills"));
  for (const item of asList(manifestJson?.skills as unknown)) {
    if (typeof item !== "string") continue;
    const path = inside("skills", item);
    if (path) addSkills(path);
  }

  // Agents and commands: the folder, or what the manifest names in its place.
  const markdown = (base: string): string[] =>
    existsSync(base)
      ? readdirSync(base, { withFileTypes: true })
          .filter((e) => e.isFile() && e.name.endsWith(".md"))
          .map((e) => join(base, e.name))
      : [];
  const named = (key: "agents" | "commands"): string[] => {
    const declaredPaths = manifestJson?.[key];
    if (declaredPaths === undefined) return markdown(join(root, key));
    if (isObject(declaredPaths)) return key === "commands" ? Object.keys(declaredPaths) : [];
    return asList(declaredPaths as unknown).flatMap((item) => {
      if (typeof item !== "string") return [];
      const path = inside(key, item);
      if (!path) return [];
      return path.endsWith(".md") ? [path] : markdown(path);
    });
  };
  const agents = named("agents").map((file) => agentName(file));
  const commands = named("commands").map((file) =>
    file.endsWith(".md") ? basename(file, ".md") : file,
  );

  // MCP servers: .mcp.json first, then the manifest's; a later name replaces an earlier one.
  const servers = new Map<string, PluginMcpServer>();
  const addServers = (map: unknown) => {
    const list = isObject(map) && isObject(map.mcpServers) ? map.mcpServers : map;
    if (!isObject(list)) return;
    for (const [name, server] of Object.entries(list)) {
      if (!isObject(server)) continue;
      const url = text(server.url);
      const args = Array.isArray(server.args) ? server.args.map(String) : [];
      servers.set(name, {
        name,
        transport: text(server.type) ?? (url ? "http" : "stdio"),
        target: url ?? [text(server.command) ?? "", ...args].join(" ").trim(),
      });
    }
  };
  if (existsSync(join(root, ".mcp.json")))
    addServers(readJson(join(root, ".mcp.json"), ".mcp.json"));
  for (const item of asList(manifestJson?.mcpServers as unknown)) {
    if (typeof item === "string" && /\.(mcpb|dxt)$|^https?:/.test(item)) {
      servers.set(basename(item), { name: basename(item), transport: "bundle", target: item });
    } else if (typeof item === "string") {
      const path = inside("mcpServers", item);
      if (path) addServers(readJson(path, item));
    } else addServers(item);
  }

  return {
    manifest,
    hooks,
    monitors,
    skills: [...skills].sort((a, b) => (a < b ? -1 : Number(a > b))),
    agents: [...agents].sort((a, b) => (a < b ? -1 : Number(a > b))),
    commands,
    mcpServers: [...servers.values()],
    attention: hooks.some((h) => h.sensitive),
    hash: hash.digest("hex"),
    files: paths.length,
    bytes,
    problems,
  };
}

const skillName = (file: string, fallback: string) => {
  const name = frontmatter(readFileSync(file, "utf8"))?.name;
  return typeof name === "string" && name.trim() !== "" ? name : fallback;
};

const agentName = (file: string) => {
  const name = frontmatter(readFileSync(file, "utf8"))?.name;
  return typeof name === "string" && name.trim() !== "" ? name : basename(file, ".md");
};
