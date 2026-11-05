import type { Dirent } from "node:fs";
import { access, readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isInside } from "../paths.ts";

/** What a project's own files would load into a Claude Code session, read without running anything (issue #196). */

export interface ProjectLoad {
  path: string;
  /** Shell commands that run on Claude Code events, by event name. */
  hooks: Array<{ event: string; file: string; commands: string[] }>;
  /** MCP servers the project declares: the name and the command that would start it. */
  mcpServers: Array<{ name: string; file: string; command: string }>;
  /** Names only: a value may be a secret. */
  envKeys: string[];
  allowRules: string[];
  defaultMode: string | null;
  agents: string[];
  skills: string[];
  commands: string[];
  claudeMd: boolean;
  /** Files that exist and could not be read as JSON, or are not what they seem. */
  unreadable: string[];
}

const MAX_FILE = 256 * 1024;
const MAX_ITEMS = 100;
const MAX_COMMAND = 300;

/** The first line of a command, cut: the rest of a script is not part of what the person is asked to judge. */
function firstLine(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  return line.length > MAX_COMMAND ? `${line.slice(0, MAX_COMMAND)}…` : line;
}

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A JSON file of the project, or why not: missing is not an error; a link out, too big or not JSON is `unreadable`. */
async function readJson(
  root: string,
  name: string,
  unreadable: string[],
): Promise<Record<string, unknown> | null> {
  const file = join(root, name);
  try {
    if (!(await exists(file))) return null;
    const real = await realpath(file);
    if (!isInside(root, real)) throw new Error("leaves the project");
    const info = await stat(real);
    if (!info.isFile() || info.size > MAX_FILE) throw new Error("not a plain file of a sane size");
    const parsed: unknown = JSON.parse(await readFile(real, "utf8"));
    if (!isObject(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    unreadable.push(name);
    return null;
  }
}

/** The names inside a folder of the project (files without their extension, or folders), never their contents. */
async function names(root: string, dir: string, folders: boolean): Promise<string[]> {
  const out: string[] = [];
  const walk = async (at: string, prefix: string, depth: number): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_ITEMS) return;
      if (entry.isDirectory()) {
        if (folders && depth === 0) out.push(entry.name);
        else if (!folders && depth < 3)
          await walk(join(at, entry.name), `${prefix}${entry.name}/`, depth + 1);
      } else if (!folders && entry.isFile() && entry.name.endsWith(".md")) {
        out.push(`${prefix}${entry.name.slice(0, -3)}`);
      }
    }
  };
  await walk(join(root, dir), "", 0);
  return out;
}

/** What the project's own files would bring into a session: read, never run. */
export async function inspectProject(path: string): Promise<ProjectLoad> {
  const root = await realpath(resolve(path)).catch(() => resolve(path));
  const unreadable: string[] = [];
  const load: ProjectLoad = {
    path: root,
    hooks: [],
    mcpServers: [],
    envKeys: [],
    allowRules: [],
    defaultMode: null,
    agents: [],
    skills: [],
    commands: [],
    claudeMd: false,
    unreadable,
  };
  for (const file of [".claude/settings.json", ".claude/settings.local.json"]) {
    const settings = await readJson(root, file, unreadable);
    if (!settings) continue;
    if (isObject(settings.hooks)) {
      for (const [event, groups] of Object.entries(settings.hooks)) {
        const commands = (Array.isArray(groups) ? groups : [])
          .flatMap((group) => (isObject(group) && Array.isArray(group.hooks) ? group.hooks : []))
          .flatMap((hook) =>
            isObject(hook) && typeof hook.command === "string" ? [firstLine(hook.command)] : [],
          );
        if (commands.length > 0)
          load.hooks.push({ event, file, commands: commands.slice(0, MAX_ITEMS) });
      }
    }
    if (isObject(settings.env)) load.envKeys.push(...Object.keys(settings.env));
    if (isObject(settings.permissions)) {
      const { allow, defaultMode } = settings.permissions;
      if (Array.isArray(allow)) {
        load.allowRules.push(
          ...allow.filter((r): r is string => typeof r === "string").map(firstLine),
        );
      }
      if (typeof defaultMode === "string") load.defaultMode = defaultMode;
    }
  }
  const mcp = await readJson(root, ".mcp.json", unreadable);
  if (mcp && isObject(mcp.mcpServers)) {
    for (const [name, server] of Object.entries(mcp.mcpServers).slice(0, MAX_ITEMS)) {
      if (!isObject(server)) continue;
      const command =
        typeof server.command === "string"
          ? [server.command, ...(Array.isArray(server.args) ? server.args.map(String) : [])].join(
              " ",
            )
          : typeof server.url === "string"
            ? server.url
            : "";
      load.mcpServers.push({ name, file: ".mcp.json", command: firstLine(command) });
    }
  }
  load.envKeys = [...new Set(load.envKeys)].sort().slice(0, MAX_ITEMS);
  load.allowRules = load.allowRules.slice(0, MAX_ITEMS);
  load.agents = await names(root, ".claude/agents", false);
  load.skills = await names(root, ".claude/skills", true);
  load.commands = await names(root, ".claude/commands", false);
  load.claudeMd = await exists(join(root, "CLAUDE.md"));
  return load;
}
