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
const asList = <T>(value: T | T[] | undefined): T[] => {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
};

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

/** What the reading of a plugin folder shares: where it is and what went wrong so far. */
interface Reading {
  root: string;
  problems: string[];
}

/** A path the manifest names, refused when it leaves the plugin; the real path or null. */
function inside(reading: Reading, key: string, rel: string): string | null {
  const target = resolve(reading.root, rel);
  const real = existsSync(target) ? realpathSync.native(target) : target;
  if (!isInside(reading.root, real)) {
    reading.problems.push(`${key}: caminho fora do plugin: ${rel}`);
    return null;
  }
  return existsSync(real) ? real : null;
}

function readJson(reading: Reading, path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    reading.problems.push(`${label}: não é um JSON válido`);
    return undefined;
  }
}

/** The hash: every file's path, size and bytes in path order; a link counts by its name and target. */
function contentHash(
  root: string,
  listing: { files: string[]; links: string[] },
): { hash: string; bytes: number } {
  const hash = createHash("sha256");
  let bytes = 0;
  for (const path of listing.files) {
    const content = readFileSync(join(root, path));
    bytes += content.length;
    if (bytes > MAX_BYTES) throw new FlightdeckError("bad_request", "plugin grande demais");
    hash.update(`F\0${path}\0${content.length}\0`).update(content).update("\0");
  }
  for (const link of listing.links) {
    hash.update(`L\0${link}\0${readlinkSync(join(root, link))}\0`);
  }
  return { hash: hash.digest("hex"), bytes };
}

/** `{ key: value }` when the value is a non-empty string, else nothing to spread. */
const field = <K extends string>(key: K, value: unknown): { [P in K]?: string } => {
  const value_ = text(value);
  return value_ ? ({ [key]: value_ } as { [P in K]: string }) : {};
};

function manifestOf(manifestJson: Json | null): PluginInventory["manifest"] {
  if (!manifestJson) return null;
  const author = manifestJson.author;
  return {
    ...field("name", manifestJson.name),
    ...field("version", manifestJson.version),
    ...field("description", manifestJson.description),
    ...field("author", isObject(author) ? author.name : author),
  };
}

/** The hooks of one event map: `{ Event: [{ matcher, hooks: [{ type, command… }] }] }`. */
function hooksOfEvents(events: unknown): PluginHook[] {
  if (!isObject(events)) return [];
  const found: PluginHook[] = [];
  for (const [event, groups] of Object.entries(events)) {
    for (const group of asList(groups as unknown).filter(isObject)) {
      for (const hook of asList(group.hooks as unknown).filter(isObject)) {
        const args = Array.isArray(hook.args) ? hook.args.map(String) : [];
        const command = [text(hook.command) ?? text(hook.url) ?? text(hook.prompt), ...args]
          .filter((part): part is string => part !== undefined)
          .join(" ");
        found.push({
          event,
          ...field("matcher", group.matcher),
          type: text(hook.type) ?? "command",
          ...(command ? { command } : {}),
          sensitive: SENSITIVE_EVENTS.includes(event),
        });
      }
    }
  }
  return found;
}

/** Hooks: hooks/hooks.json first, then what the manifest adds (a file, an inline map, or a list). */
function hooksOf(reading: Reading, manifestJson: Json | null): PluginHook[] {
  const fromFile = (path: string, label: string) => {
    const file = readJson(reading, path, label);
    return hooksOfEvents(isObject(file) ? file.hooks : undefined);
  };
  const own = join(reading.root, "hooks", "hooks.json");
  const hooks = existsSync(own) ? fromFile(own, "hooks/hooks.json") : [];
  for (const item of asList(manifestJson?.hooks as unknown)) {
    if (typeof item !== "string") {
      hooks.push(...hooksOfEvents(item));
      continue;
    }
    const path = inside(reading, "hooks", item);
    if (path) hooks.push(...fromFile(path, item));
  }
  return hooks;
}

function monitorsOfList(list: unknown): PluginMonitor[] {
  return asList(list as unknown)
    .filter(isObject)
    .flatMap((item) =>
      text(item.name) && text(item.command)
        ? [
            {
              name: text(item.name) as string,
              command: text(item.command) as string,
              description: text(item.description) ?? "",
              when: text(item.when) ?? "always",
            },
          ]
        : [],
    );
}

/** Monitors: the manifest's list or file, else monitors/monitors.json. */
function monitorsOf(reading: Reading, manifestJson: Json | null): PluginMonitor[] {
  const experimental = isObject(manifestJson?.experimental) ? manifestJson?.experimental : null;
  const declared = experimental?.monitors ?? manifestJson?.monitors;
  if (declared === undefined) {
    const file = join(reading.root, "monitors", "monitors.json");
    return existsSync(file)
      ? monitorsOfList(readJson(reading, file, "monitors/monitors.json"))
      : [];
  }
  if (typeof declared !== "string") return monitorsOfList(declared);
  const path = inside(reading, "monitors", declared);
  return path ? monitorsOfList(readJson(reading, path, declared)) : [];
}

/** A skill's file when it is a regular file; a link is never followed. */
const skillFile = (file: string): boolean => existsSync(file) && !lstatSync(file).isSymbolicLink();

function skillsUnder(base: string): string[] {
  if (!existsSync(base)) return [];
  const own = join(base, "SKILL.md");
  const names = skillFile(own) ? [skillName(own, basename(base))] : [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const file = join(base, entry.name, "SKILL.md");
    if (entry.isDirectory() && skillFile(file)) names.push(skillName(file, entry.name));
  }
  return names;
}

/** Skills: skills/ and the folders the manifest adds. */
function skillsOf(reading: Reading, manifestJson: Json | null): string[] {
  const skills = new Set(skillsUnder(join(reading.root, "skills")));
  for (const item of asList(manifestJson?.skills as unknown)) {
    if (typeof item !== "string") continue;
    const path = inside(reading, "skills", item);
    if (path) for (const name of skillsUnder(path)) skills.add(name);
  }
  return [...skills];
}

const markdownIn = (base: string): string[] =>
  existsSync(base)
    ? readdirSync(base, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => join(base, e.name))
    : [];

/** Agents and commands: the folder, or what the manifest names in its place. */
function namedOf(reading: Reading, manifestJson: Json | null, key: "agents" | "commands") {
  const declaredPaths = manifestJson?.[key];
  if (declaredPaths === undefined) return markdownIn(join(reading.root, key));
  if (isObject(declaredPaths)) return key === "commands" ? Object.keys(declaredPaths) : [];
  return asList(declaredPaths as unknown).flatMap((item) => {
    if (typeof item !== "string") return [];
    const path = inside(reading, key, item);
    if (!path) return [];
    return path.endsWith(".md") ? [path] : markdownIn(path);
  });
}

function serversOfMap(map: unknown): Array<[string, PluginMcpServer]> {
  const list = isObject(map) && isObject(map.mcpServers) ? map.mcpServers : map;
  if (!isObject(list)) return [];
  return Object.entries(list)
    .filter((entry): entry is [string, Json] => isObject(entry[1]))
    .map(([name, server]) => {
      const url = text(server.url);
      const args = Array.isArray(server.args) ? server.args.map(String) : [];
      const fallback = url ? "http" : "stdio";
      return [
        name,
        {
          name,
          transport: text(server.type) ?? fallback,
          target: url ?? [text(server.command) ?? "", ...args].join(" ").trim(),
        },
      ];
    });
}

/** MCP servers: .mcp.json first, then the manifest's; a later name replaces an earlier one. */
function serversOf(reading: Reading, manifestJson: Json | null): PluginMcpServer[] {
  const servers = new Map<string, PluginMcpServer>();
  const add = (map: unknown) => {
    for (const [name, server] of serversOfMap(map)) servers.set(name, server);
  };
  const own = join(reading.root, ".mcp.json");
  if (existsSync(own)) add(readJson(reading, own, ".mcp.json"));
  for (const item of asList(manifestJson?.mcpServers as unknown)) {
    if (typeof item !== "string") add(item);
    else if (/\.(mcpb|dxt)$|^https?:/.test(item)) {
      servers.set(basename(item), { name: basename(item), transport: "bundle", target: item });
    } else {
      const path = inside(reading, "mcpServers", item);
      if (path) add(readJson(reading, path, item));
    }
  }
  return [...servers.values()];
}

export function inspectPlugin(dir: string): PluginInventory {
  if (!existsSync(dir)) throw new FlightdeckError("not_found", `${dir} não existe`);
  const reading: Reading = { root: realpathSync.native(resolve(dir)), problems: [] };
  const { root } = reading;

  const listing = filesUnder(root);
  const { hash, bytes } = contentHash(root, listing);

  const manifestPath = join(root, ".claude-plugin", "plugin.json");
  const raw = existsSync(manifestPath) ? readJson(reading, manifestPath, "plugin.json") : undefined;
  const manifestJson = isObject(raw) ? raw : null;

  const hooks = hooksOf(reading, manifestJson);
  const monitors = monitorsOf(reading, manifestJson);
  const skills = skillsOf(reading, manifestJson);
  const agents = namedOf(reading, manifestJson, "agents").map((file) => agentName(file));
  const commands = namedOf(reading, manifestJson, "commands").map((file) =>
    file.endsWith(".md") ? basename(file, ".md") : file,
  );
  const mcpServers = serversOf(reading, manifestJson);

  const byText = (a: string, b: string) => (a < b ? -1 : Number(a > b));
  return {
    manifest: manifestOf(manifestJson),
    hooks,
    monitors,
    skills: skills.sort(byText),
    agents: agents.sort(byText),
    commands,
    mcpServers,
    attention: hooks.some((h) => h.sensitive),
    hash,
    files: listing.files.length,
    bytes,
    problems: reading.problems,
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
