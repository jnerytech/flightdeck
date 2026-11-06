/**
 * Phase 39 (ADR 39-1): before an OpenCode session starts or resumes, three read-only checks through
 * OpenCode itself, once the global scope passed the file scan (so no plugin can load): the config
 * sources are only the global folder and our inline document; our two agents resolve with our rules
 * last; the folder's project has no saved `always` rule. A pass is cached for 10 minutes.
 */

import { join } from "node:path";
import { FlightdeckError } from "../errors.ts";
import {
  FLIGHTDECK_AGENT,
  FLIGHTDECK_PLAN_AGENT,
  OPENCODE_API_TIMEOUT_MS,
  opencodeConfig,
  opencodeEnv,
  type PermissionRule,
} from "./opencode-config.ts";
import type { RunResult } from "./opencode-discovery.ts";
import { CONFIG_FILES, globalConfigDir, type ScopeResult } from "./opencode-scope.ts";

export const PREFLIGHT_CACHE_MS = 10 * 60_000;

export interface PreflightDeps {
  path: string;
  version: string;
  /** The session's environment, before the OpenCode variables. */
  env: Record<string, string>;
  run: (
    argv: string[],
    opts: { cwd: string; env: Record<string, string>; timeoutMs: number },
  ) => Promise<RunResult>;
  scan: () => Promise<ScopeResult>;
  now?: () => number;
  /** The executable as discovery saw it, and how it is now. */
  exe?: { fingerprint: string; current: () => Promise<string | null> };
  /** Why a preflight failed: the route and its exit code, never what OpenCode printed. */
  log?: (message: string) => void;
}

/** A check that did not answer: its route and why, with nothing of what OpenCode printed. */
class CheckFailed extends Error {}

/** OpenCode's own internal agents, which stay visible as hidden ones. */
const INTERNAL_AGENTS = new Set(["compaction", "title", "summary"]);

/**
 * The first config source that is neither our inline document, the global folder nor one of its
 * config files (the scope scan read those already); null when there is none.
 */
export function unexpectedSource(
  sources: Array<{ type?: string; path?: string }>,
  global: string,
): string | null {
  for (const source of sources) {
    const ours = source.type === "document" && source.path === undefined;
    const theirs =
      (source.type === "directory" && source.path === global) ||
      (source.type === "document" &&
        CONFIG_FILES.some((name) => source.path === join(global, name)));
    if (!ours && !theirs) return source.path ?? String(source.type);
  }
  return null;
}

/** At most 40 characters of a saved rule's resource, with token-like runs hidden. */
export function maskResource(resource: string): string {
  // Keys, JWTs and base64 carry dots, slashes and pluses, and may end in `=` padding.
  const masked = resource.replace(/[A-Za-z0-9_\-+/.]{16,}={0,2}/g, "•••");
  return masked.length > 40 ? `${masked.slice(0, 40)}…` : masked;
}

interface AgentInfo {
  id: string;
  permissions?: PermissionRule[];
}

const sameRule = (a: PermissionRule, b: PermissionRule) =>
  a.action === b.action && a.resource === b.resource && a.effect === b.effect;

/** Whether `rules` ends with `ours`, followed only by `deny` rules. */
function oursLast(rules: PermissionRule[], ours: PermissionRule[]): boolean {
  for (let start = rules.length - ours.length; start >= 0; start--) {
    const tail = rules.slice(start + ours.length);
    if (tail.some((rule) => rule.effect !== "deny")) continue;
    if (ours.every((rule, i) => sameRule(rule, rules[start + i] as PermissionRule))) return true;
  }
  return false;
}

/** The answer's list: an array, or `{ data: [...] }`. */
function list<T>(body: unknown): T[] {
  const items = Array.isArray(body) ? body : (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(items)) throw new Error("not a list");
  return items as T[];
}

export class OpenCodePreflight {
  private readonly passed = new Map<string, { at: number; configContent: string }>();
  private readonly running = new Map<string, Promise<{ configContent: string }>>();

  constructor(private readonly deps: PreflightDeps) {}

  /** Throws a typed refusal; answers the config content the session must use. */
  async check(cwd: string): Promise<{ configContent: string }> {
    const scope = await this.deps.scan();
    if (scope.findings.length > 0) {
      throw this.refuse("opencode_unsafe_global", {
        found: scope.findings
          .map((f) => `${f.kind}${f.detail ? ` ${f.detail}` : ""} (${f.path})`)
          .join("\n"),
      });
    }
    const now = (this.deps.now ?? Date.now)();
    const key = `${cwd}\0${this.deps.version}\0${scope.fingerprint}`;
    const cached = this.passed.get(key);
    if (cached && now - cached.at < PREFLIGHT_CACHE_MS)
      return { configContent: cached.configContent };
    // A binary replaced since discovery checked it (an upgrade) is not trusted until checked again.
    if (this.deps.exe && (await this.deps.exe.current()) !== this.deps.exe.fingerprint) {
      throw this.refuse("opencode_changed", {});
    }
    // Two sessions of one folder starting together share one run of the three commands.
    const running = this.running.get(key);
    if (running) return running;
    const run = this.checks(cwd)
      .then((configContent) => {
        this.passed.set(key, { at: now, configContent });
        return { configContent };
      })
      .catch((error: unknown) => {
        if (error instanceof FlightdeckError) throw error;
        const why =
          error instanceof CheckFailed
            ? error.message
            : "a check could not run, or its answer had an unexpected shape";
        this.deps.log?.(`opencode preflight failed in ${cwd}: ${why}`);
        throw this.refuse("opencode_preflight_failed", {});
      })
      .finally(() => this.running.delete(key));
    this.running.set(key, run);
    return run;
  }

  private async checks(cwd: string): Promise<string> {
    let content = JSON.stringify(opencodeConfig());
    const [sources, agents, saved] = await Promise.all([
      this.get(cwd, "/api/config", content),
      this.get(cwd, "/api/agent", content),
      this.get(cwd, "/api/permission/saved", content),
    ]);
    const unexpected = unexpectedSource(list(sources), globalConfigDir(this.deps.env));
    if (unexpected) throw this.refuse("opencode_config_outranks", { what: unexpected });
    const rules = list<{ id: string; action: string; resource: string }>(saved);
    if (rules.length > 0) {
      throw this.refuse("opencode_saved_rules", {
        rules: rules.map((r) => `${maskResource(r.action)} ${maskResource(r.resource)}`).join("\n"),
        // Only a plain id goes into a command the person may paste.
        commands: rules
          .filter((r) => /^[\w-]+$/.test(r.id))
          .map((r) => `opencode api DELETE /api/permission/saved/${r.id}`)
          .join("\n"),
      });
    }
    const extra = this.extraAgents(list<AgentInfo>(agents));
    if (extra.length === 0) return content;
    content = JSON.stringify(opencodeConfig(extra));
    const still = this.extraAgents(list<AgentInfo>(await this.get(cwd, "/api/agent", content)));
    if (still.length > 0)
      throw this.refuse("opencode_config_outranks", { what: still[0] as string });
    return content;
  }

  /** Checks our two agents and answers the ids of any other visible agent. */
  private extraAgents(agents: AgentInfo[]): string[] {
    const config = opencodeConfig() as {
      agents: Record<string, { permissions: PermissionRule[] }>;
    };
    for (const id of [FLIGHTDECK_AGENT, FLIGHTDECK_PLAN_AGENT]) {
      const found = agents.find((agent) => agent.id === id);
      const ours = config.agents[id]?.permissions ?? [];
      if (!found || !oursLast(found.permissions ?? [], ours))
        throw this.refuse("opencode_config_outranks", { what: id });
    }
    return agents
      .map((agent) => agent.id)
      .filter(
        (id) => id !== FLIGHTDECK_AGENT && id !== FLIGHTDECK_PLAN_AGENT && !INTERNAL_AGENTS.has(id),
      );
  }

  private async get(cwd: string, route: string, content: string): Promise<unknown> {
    const result = await this.deps.run([this.deps.path, "api", "GET", route, "--standalone"], {
      cwd,
      env: opencodeEnv(this.deps.env, content),
      timeoutMs: OPENCODE_API_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) throw new CheckFailed(`${route} exited ${result.exitCode}`);
    try {
      return JSON.parse(result.stdout) as unknown;
    } catch {
      // The parser's message quotes the output, which is not for logs.
      throw new CheckFailed(`${route} answered something that is not JSON`);
    }
  }

  private refuse(reason: string, params: Record<string, string>): FlightdeckError {
    return new FlightdeckError(
      "invalid_state",
      `OpenCode ${this.deps.version} cannot start this session (${reason})`,
      reason,
      { version: this.deps.version, ...params },
    );
  }
}
