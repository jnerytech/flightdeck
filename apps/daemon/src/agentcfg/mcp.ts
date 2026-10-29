/**
 * Phase 12: the MCP servers that apply to a project, with where each comes from. The project's
 * `.mcp.json` (versioned) is editable; `~/.claude.json` (user servers, and the project's part of
 * it) is read-only. `.claude/settings.local.json` turns `.mcp.json` servers on and off. Secrets
 * are masked, and "Testar" only starts a server with confirm, after showing the exact command.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const readJson = (path: string): Json =>
  existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Json) : {};

function writeJson(path: string, value: Json): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const servers = (value: unknown) => (value ?? {}) as Record<string, McpServerConfig>;

const masked = (values?: Record<string, string>) =>
  values ? Object.fromEntries(Object.keys(values).map((k) => [k, MASK])) : undefined;

function confirmed(confirm: boolean, what: string): void {
  if (!confirm) throw new FlightdeckError("invalid_state", `${what} pede confirm: true`);
}

export class McpConfig {
  constructor(private readonly opts: { userConfigPath?: string; timeoutMs?: number } = {}) {}

  list(project: string): McpServerView[] {
    const local = readJson(join(project, ".claude", "settings.local.json"));
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
    return Object.entries(this.sources(project)).flatMap(([origin, found]) =>
      Object.entries(found).map(([n, c]) => view(n, c, origin as McpServerView["origin"])),
    );
  }

  /** Adds or replaces a server in .mcp.json, keeping every other key and server. */
  save(project: string, server: McpServerConfig & { name: string }, confirm: boolean): void {
    confirmed(confirm, "gravar no .mcp.json");
    this.editable(project, server.name, true);
    const { name, ...config } = server;
    const secrets = { ...config.env, ...config.headers };
    if (Object.values(secrets).includes(MASK)) {
      throw new FlightdeckError(
        "invalid_state",
        "valores de env e headers aparecem mascarados: digite o valor de novo para salvar",
      );
    }
    const file = this.projectFile(project);
    const current = readJson(file);
    writeJson(file, { ...current, mcpServers: { ...servers(current.mcpServers), [name]: config } });
  }

  remove(project: string, name: string, confirm: boolean): void {
    confirmed(confirm, "remover do .mcp.json");
    this.editable(project, name, false);
    const file = this.projectFile(project);
    const current = readJson(file);
    const { [name]: _removed, ...rest } = servers(current.mcpServers);
    writeJson(file, { ...current, mcpServers: rest });
  }

  /** Moves a .mcp.json server between the enabled and disabled lists of settings.local.json. */
  toggle(project: string, name: string, enabled: boolean, confirm: boolean): void {
    confirmed(confirm, "ligar ou desligar um servidor");
    this.editable(project, name, false);
    const file = join(project, ".claude", "settings.local.json");
    const current = readJson(file);
    const without = (key: string) => ((current[key] ?? []) as string[]).filter((n) => n !== name);
    const on = without("enabledMcpjsonServers");
    const off = without("disabledMcpjsonServers");
    writeJson(file, {
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
    const config = this.real(project, name);
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
              `o servidor ${name} não respondeu em ${timeoutMs / 1000} s`,
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
  private sources(
    project: string,
  ): Record<McpServerView["origin"], Record<string, McpServerConfig>> {
    const user = readJson(this.userConfigPath());
    const userProject = Object.entries((user.projects ?? {}) as Record<string, Json>).find(
      ([path]) => samePath(path, project),
    )?.[1];
    return {
      project: servers(readJson(this.projectFile(project)).mcpServers),
      user: servers(user.mcpServers),
      "user-project": servers(userProject?.mcpServers),
    };
  }

  /** The server's real config (with secrets), wherever it comes from. */
  private real(project: string, name: string): McpServerConfig {
    const found = this.sources(project);
    const config = found.project[name] ?? found.user[name] ?? found["user-project"][name];
    if (!config) throw new FlightdeckError("not_found", `servidor MCP ${name} não existe`);
    return config;
  }

  /** Only .mcp.json servers change; `creating` allows a name that does not exist yet. */
  private editable(project: string, name: string, creating: boolean): void {
    const found = this.list(project).find((s) => s.name === name);
    if (found?.readOnly) {
      throw new FlightdeckError(
        "invalid_state",
        `o servidor ${name} vem do ~/.claude.json, que o Flightdeck só lê`,
      );
    }
    if (!found && !creating)
      throw new FlightdeckError("not_found", `servidor MCP ${name} não existe`);
  }
}
