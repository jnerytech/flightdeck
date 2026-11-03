/**
 * Phase 12: the MCP servers that apply to a project, with where each comes from. The project's
 * `.mcp.json` (versioned) is editable; `~/.claude.json` (user servers, and the project's part of
 * it) is read-only. `.claude/settings.local.json` turns `.mcp.json` servers on and off. Secrets
 * are masked, and "Testar" only starts a server with confirm, after showing the exact command.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { userHome } from "../config.ts";
import { FlightdeckError } from "../errors.ts";
import { samePath } from "../paths.ts";

/** What secrets (env and headers values) look like in the app. */
export const MASK = "••••••";

export interface McpServerConfig {
  type?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface McpServerView extends McpServerConfig {
  name: string;
  /** `project` (.mcp.json), `user` or `user-project` (both from ~/.claude.json). */
  origin: "project" | "user" | "user-project";
  readOnly: boolean;
  transport: "stdio" | "http" | "sse";
  enabled: boolean;
}

export type McpTestResult =
  | { preview: { command?: string; args?: string[]; url?: string } }
  | { tools: string[]; resources: string[] };

type Json = Record<string, unknown>;

/** The JSON object in the file; `{}` when the file is not there (a file that does not parse throws). */
async function readJson(path: string): Promise<Json> {
  const text = await readFile(path, "utf8").catch(() => null);
  return text === null ? {} : (JSON.parse(text) as Json);
}

async function writeJson(path: string, value: Json): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

const servers = (value: unknown) => (value ?? {}) as Record<string, McpServerConfig>;

const masked = (values?: Record<string, string>) =>
  values ? Object.fromEntries(Object.keys(values).map((k) => [k, MASK])) : undefined;

const missing = (name: string) =>
  new FlightdeckError("not_found", `MCP server ${name} does not exist`, "mcp_server_missing", {
    name,
  });

function confirmed(confirm: boolean, what: string, reason: string): void {
  if (!confirm) {
    throw new FlightdeckError("invalid_state", `${what} needs confirm: true`, reason);
  }
}

export class McpConfig {
  constructor(private readonly opts: { userConfigPath?: string; timeoutMs?: number } = {}) {}

  async list(project: string): Promise<McpServerView[]> {
    const local = await readJson(join(project, ".claude", "settings.local.json"));
    const disabled = (local.disabledMcpjsonServers ?? []) as string[];
    const view = (
      name: string,
      config: McpServerConfig,
      origin: McpServerView["origin"],
    ): McpServerView => {
      const { env, headers, ...rest } = config;
      return {
        name,
        ...rest,
        ...(env ? { env: masked(env) } : {}),
        ...(headers ? { headers: masked(headers) } : {}),
        origin,
        readOnly: origin !== "project",
        transport: config.type ?? (config.url ? "http" : "stdio"),
        enabled: origin !== "project" || !disabled.includes(name),
      };
    };
    return Object.entries(await this.sources(project)).flatMap(([origin, found]) =>
      Object.entries(found).map(([n, c]) => view(n, c, origin as McpServerView["origin"])),
    );
  }

  /** Adds or replaces a server in .mcp.json, keeping every other key and server. */
  async save(
    project: string,
    server: McpServerConfig & { name: string },
    confirm: boolean,
  ): Promise<void> {
    confirmed(confirm, "writing to .mcp.json", "mcp_write_confirm");
    await this.editable(project, server.name, true);
    const { name, ...config } = server;
    const secrets = { ...config.env, ...config.headers };
    if (Object.values(secrets).includes(MASK)) {
      throw new FlightdeckError(
        "invalid_state",
        "env and header values show masked: type the value again to save",
        "mcp_masked_values",
      );
    }
    const file = this.projectFile(project);
    const current = await readJson(file);
    await writeJson(file, {
      ...current,
      mcpServers: { ...servers(current.mcpServers), [name]: config },
    });
  }

  async remove(project: string, name: string, confirm: boolean): Promise<void> {
    confirmed(confirm, "removing from .mcp.json", "mcp_remove_confirm");
    await this.editable(project, name, false);
    const file = this.projectFile(project);
    const current = await readJson(file);
    const { [name]: _removed, ...rest } = servers(current.mcpServers);
    await writeJson(file, { ...current, mcpServers: rest });
  }

  /** Moves a .mcp.json server between the enabled and disabled lists of settings.local.json. */
  async toggle(project: string, name: string, enabled: boolean, confirm: boolean): Promise<void> {
    confirmed(confirm, "turning a server on or off", "mcp_toggle_confirm");
    await this.editable(project, name, false);
    const file = join(project, ".claude", "settings.local.json");
    const current = await readJson(file);
    const without = (key: string) => ((current[key] ?? []) as string[]).filter((n) => n !== name);
    const on = without("enabledMcpjsonServers");
    const off = without("disabledMcpjsonServers");
    await writeJson(file, {
      ...current,
      disabledMcpjsonServers: enabled ? off : [...off, name],
      enabledMcpjsonServers: enabled ? [...on, name] : on,
    });
  }

  /**
   * Without confirm, only what would run (a stdio server runs a command from the repository).
   * With it, starts the server, lists its tools and resources and stops it.
   */
  async test(project: string, name: string, confirm: boolean): Promise<McpTestResult> {
    const config = await this.real(project, name);
    if (!confirm) {
      return config.url
        ? { preview: { url: config.url } }
        : { preview: { command: config.command as string, args: config.args ?? [] } };
    }
    const client = new Client({ name: "flightdeck", version: "1.0.0" });
    const transport = config.url
      ? new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: { headers: config.headers ?? {} },
        })
      : new StdioClientTransport({
          command: config.command as string,
          args: config.args ?? [],
          env: { ...(process.env as Record<string, string>), ...config.env },
          cwd: project,
          stderr: "ignore",
        });
    const timeoutMs = this.opts.timeoutMs ?? 15_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new FlightdeckError(
              "invalid_state",
              `the server ${name} did not answer in ${timeoutMs / 1000} s`,
              "mcp_timeout",
              { name, seconds: timeoutMs / 1000 },
            ),
          ),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([
        (async () => {
          await client.connect(transport);
          const tools = (await client.listTools()).tools.map((t) => t.name);
          const resources = await client
            .listResources()
            .then((r) => r.resources.map((x) => x.name))
            .catch(() => []);
          return { tools, resources };
        })(),
        late,
      ]);
    } finally {
      clearTimeout(timer);
      // Best effort: a server that never answered may fail to close too.
      await Promise.allSettled([client.close(), transport.close()]);
    }
  }

  private userConfigPath(): string {
    return this.opts.userConfigPath ?? join(userHome(), ".claude.json");
  }

  private projectFile(project: string): string {
    return join(project, ".mcp.json");
  }

  /**
   * Where a project's servers come from, in that order, with their real values. ~/.claude.json
   * keys its projects by absolute path.
   */
  private async sources(
    project: string,
  ): Promise<Record<McpServerView["origin"], Record<string, McpServerConfig>>> {
    const user = await readJson(this.userConfigPath());
    const userProject = Object.entries((user.projects ?? {}) as Record<string, Json>).find(
      ([path]) => samePath(path, project),
    )?.[1];
    return {
      project: servers((await readJson(this.projectFile(project))).mcpServers),
      user: servers(user.mcpServers),
      "user-project": servers(userProject?.mcpServers),
    };
  }

  /** The server's real config (with secrets), wherever it comes from. */
  private async real(project: string, name: string): Promise<McpServerConfig> {
    const found = await this.sources(project);
    const config = found.project[name] ?? found.user[name] ?? found["user-project"][name];
    if (!config) throw missing(name);
    return config;
  }

  /** Only .mcp.json servers change; `creating` allows a name that does not exist yet. */
  private async editable(project: string, name: string, creating: boolean): Promise<void> {
    const found = (await this.list(project)).find((s) => s.name === name);
    if (found?.readOnly) {
      throw new FlightdeckError(
        "invalid_state",
        `the server ${name} comes from ~/.claude.json, which Flightdeck only reads`,
        "mcp_server_external",
        { name },
      );
    }
    if (!found && !creating) throw missing(name);
  }
}
