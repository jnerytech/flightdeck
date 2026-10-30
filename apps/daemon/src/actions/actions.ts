/**
 * Phase 17: the actions service. An action is a command the user declared, with places for
 * secrets and parameters; Claude calls it by name and only chooses the parameters. The secret is
 * applied on this side and what comes back is masked.
 *
 * Where the secret comes from: a run the user starts in the app finds it already delivered (for
 * `action:<name>:you`); a run Claude, an automation or a workflow starts makes the daemon ask the
 * app (`vault.request`), and the app delivers it for that one request after the user's approval,
 * or answers no. The trust in an action covers what it executes, not only its declaration, and is
 * checked again right before the program starts.
 */
import type { Database } from "bun:sqlite";
import { homedir } from "node:os";
import type {
  ActionInfo,
  ActionList,
  ActionResult,
  ActionRunInfo,
  VaultAlertFrame,
  VaultDaemonRequester,
  VaultDecisionInfo,
  VaultReportRow,
  VaultRequester,
  VaultRequestFrame,
  VaultUsed,
  VaultVerdict,
} from "@flightdeck/protocol";
import { git } from "../board/command.ts";
import { must } from "../board/worktree.ts";
import { FlightdeckError } from "../errors.ts";
import { ulid } from "../ulid.ts";
import { decideRequest } from "../vault/requests.ts";
import type { Risk } from "../vault/rules.ts";
import type { VaultRules } from "../vault/rules-store.ts";
import type { Vault } from "../vault/vault.ts";
import { type RunResult, resolveParams, runAction, type SshExecutor } from "./run.ts";
import { type ActionDef, approvalOf, parseActions, secretsOf, validateAction } from "./schema.ts";
import { shellLine } from "./shell.ts";
import { changes, type Fingerprint, fingerprint } from "./trust.ts";

/** What the service needs to know of a project. */
export interface ActionProject {
  id: string;
  path: string;
  baseBranch: string;
}

export interface ActionsOptions {
  db: Database;
  vault: Vault;
  /** The project by id; throws `not_found` for one that does not exist. */
  projects: (id: string) => ActionProject;
  /** Where host actions (and free commands) run; the home folder when absent. */
  hostBase?: string | undefined;
  /** The daemon's environment; what reaches a program is cleaned. */
  baseEnv?: Record<string, string | undefined> | undefined;
  /** The SSH destinations of phase 15 plug in here. */
  ssh?: SshExecutor | undefined;
  /** The vault secret that holds a destino's key (`vault-key`), or null when it has none. */
  sshKey?: ((target: string) => string | null) | undefined;
  /** How long a request waits for the app, and then is denied (10 minutes when absent). */
  requestTimeoutMs?: number | undefined;
  /** Phase 19: the rules of each secret; without them the requests of phase 17 apply. */
  rules?: VaultRules | undefined;
  /** This host's name, as the rules' `host` matches it. */
  hostName?: string | undefined;
  /** What the classifier of phase 13 says of a command. */
  risk?: ((command: string, cwd: string) => Risk) | undefined;
  /** The `projectKey` of a project, as the rules' `project` matches it. */
  projectKey?: ((projectId: string) => string | undefined) | undefined;
  clock?: (() => number) | undefined;
  /** The PC's time zone for the rules' windows (the system's when absent). */
  timeZone?: string | undefined;
}

export type ActionsFrame = VaultRequestFrame | VaultUsed | VaultAlertFrame;

/** A request nobody answers is denied after this long. */
export const REQUEST_TTL_MS = 10 * 60_000;

/** Versioned actions live here, read from the project's base branch only. */
export const ACTIONS_FILE = ".flightdeck/actions.yaml";

/** The name a free command is recorded under. */
const FREE = "run_with_secret";
const SECRET_ID = /^[A-Za-z0-9._-]+$/;

const bad = (message: string) => new FlightdeckError("bad_request", message);
const invalid = (message: string) => new FlightdeckError("invalid_state", message);
const now = () => new Date().toISOString();

/** An action and where it came from. */
interface Found {
  action: ActionDef;
  source: "app" | "versioned";
  /** The project id, or '' for the host. */
  scope: string;
  /** The folder its relative paths are resolved against. */
  base: string;
}

interface TrustRow {
  declaration: string;
  files: string;
}

interface RunRow {
  id: string;
  scope: string;
  name: string;
  requested_by: VaultRequester;
  started_at: string;
  duration_ms: number;
  exit_code: number;
  timed_out: number;
  truncated: number;
  output: string;
}

/** What goes into the `vault.request` frames of one run, besides the secret. */
interface Ask {
  requester: VaultRequester;
  /** Before the request id, in the purpose the secret is delivered for. */
  purposeBase: string;
  frame: Partial<VaultRequestFrame>;
}

export class Actions {
  private readonly listeners = new Set<(frame: ActionsFrame) => void>();
  private readonly pending = new Map<string, { controller: AbortController; denied: boolean }>();

  constructor(private readonly opts: ActionsOptions) {}

  /** The app's stream of `vault.request` and `vault.used` frames; answers how to stop it. */
  watch(listener: (frame: ActionsFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The user refused a request: the run that waits for it fails at once. */
  deny(requestId: string): void {
    const waiting = this.pending.get(requestId);
    if (!waiting) return;
    waiting.denied = true;
    waiting.controller.abort();
  }

  /** The user approved a request that asked; the delivery of its secret is allowed after this. */
  approve(
    _requestId: string,
    _approval: {
      via: "app" | "tray";
      heldMs?: number | undefined;
      scope?: "once" | "session" | undefined;
    },
  ): void {}

  /** Throws unless a delivery for `purpose` may go through: a request that asks has to be approved. */
  gate(_purpose: string): void {}

  /** The verdict for a use, without recording anything. */
  preview(_use: {
    secretId: string;
    requester: VaultRequester;
    purpose: "ssh" | "action" | "run_with_secret";
    action?: string | undefined;
    host?: string | undefined;
    tags?: string[] | undefined;
    project?: string | undefined;
    session?: string | undefined;
    risk?: Risk | undefined;
    actionApproval?: "always" | "never" | "first-per-session" | undefined;
    at?: number | undefined;
  }): VaultVerdict {
    return {
      decision: "deny",
      ruleId: null,
      reason: "",
      once: false,
      needsHold: false,
      limited: false,
    };
  }

  decisions(_input: {
    secretId?: string | undefined;
    days?: number | undefined;
    limit?: number | undefined;
  }): VaultDecisionInfo[] {
    return [];
  }

  report(_input: { days?: number | undefined; format?: "json" | "csv" | undefined }): {
    rows: VaultReportRow[];
    csv?: string;
  } {
    return { rows: [] };
  }

  /** Nothing that waits outlives the daemon. */
  stop(): void {
    for (const waiting of this.pending.values()) waiting.controller.abort();
    this.listeners.clear();
  }

  /** The actions a project sees (its own, then the host's) or, with no project, the host's. */
  async list(projectId?: string): Promise<ActionList> {
    const { found, errors } = await this.visible(projectId);
    return { actions: found.map((f) => this.info(f)), errors };
  }

  async save(input: {
    projectId?: string | undefined;
    definition: Record<string, unknown>;
    secretIds?: string[] | undefined;
  }): Promise<ActionInfo> {
    const { action, errors } = validateAction(
      input.definition,
      input.secretIds ? { secretIds: new Set(input.secretIds) } : {},
    );
    if (!action) throw bad(errors.join("; "));
    const scope = input.projectId ?? "";
    const base = this.baseOf(input.projectId);
    this.opts.db
      .query(
        `INSERT INTO actions (scope, name, definition, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (scope, name) DO UPDATE SET definition = excluded.definition`,
      )
      .run(scope, action.name, JSON.stringify(action), now());
    // What the app creates is trusted as it is saved; a later change to what it executes is not.
    this.pin({ action, source: "app", scope, base });
    return this.info({ action, source: "app", scope, base });
  }

  async remove(projectId: string | undefined, name: string): Promise<ActionList> {
    const scope = projectId ?? "";
    this.baseOf(projectId);
    const removed = this.opts.db
      .query("DELETE FROM actions WHERE scope = ? AND name = ?")
      .run(scope, name);
    if (removed.changes === 0) throw new FlightdeckError("not_found", `a ação ${name} não existe`);
    this.opts.db.query("DELETE FROM action_trust WHERE scope = ? AND name = ?").run(scope, name);
    return this.list(projectId);
  }

  /** Trusts the action as it is now; `hash` is the declaration the user reviewed. */
  async trust(projectId: string | undefined, name: string, hash: string): Promise<ActionInfo> {
    const found = await this.find(projectId, name);
    if (fingerprint(found.action, found.base).declaration !== hash) {
      throw invalid(`a ação ${name} mudou; revise de novo antes de confiar`);
    }
    this.pin(found);
    return this.info(found);
  }

  async run(input: {
    projectId?: string | undefined;
    name: string;
    params?: Record<string, string> | undefined;
    requestedBy: VaultRequester;
    session?: string | undefined;
  }): Promise<ActionResult> {
    const found = await this.find(input.projectId, input.name);
    this.assertTrusted(found);
    const params = resolveParams(found.action, input.params ?? {});
    const { values, files } = secretsOf(found.action);
    // A destino that logs in with a key from the vault: the key is asked for like the secrets.
    const keyId = found.action.ssh ? (this.opts.sshKey?.(found.action.ssh) ?? null) : null;
    const ids = [...new Set([...values, ...files, ...(keyId ? [keyId] : [])])];
    const secrets = await this.collect(ids, {
      requester: input.requestedBy,
      purposeBase: `action:${found.action.name}`,
      frame: { action: found.action.name, params, approval: approvalOf(found.action) },
    });
    // The approval can take a while: what the action executes is checked again before it starts.
    this.assertTrusted(found);
    return this.execute(found, params, secrets, input.requestedBy, ids, keyId);
  }

  /**
   * A command Claude wrote, with the secrets in its environment (`deploy-token` is
   * `DEPLOY_TOKEN`). It is never automatic: the request carries `always`, with the exact command,
   * the names of the secrets and the host, and nothing runs without the app delivering them.
   */
  async runFree(input: {
    command: string;
    secrets: string[];
    host?: string | undefined;
    requestedBy: VaultRequester;
    session?: string | undefined;
  }): Promise<ActionResult> {
    const requester = this.permit(input.requestedBy);
    // Another host is a phase 15 destino of that name: the command runs there with sh -c.
    const remote = input.host !== undefined && input.host !== "local" ? input.host : null;
    if (remote && !this.opts.ssh) {
      throw invalid(
        `o host ${remote} é um destino SSH, e este daemon não roda comandos nos destinos da Fase 15`,
      );
    }
    const ids = [...new Set(input.secrets)];
    for (const id of ids) if (!SECRET_ID.test(id)) throw bad(`nome de segredo inválido: ${id}`);
    const line = remote ? null : shellLine(input.command, process.platform);
    const keyId = remote ? (this.opts.sshKey?.(remote) ?? null) : null;
    try {
      const action: ActionDef = {
        name: FREE,
        description: "comando livre com segredos no ambiente",
        run: line ? line.argv : ["sh", "-c", input.command],
        env: Object.fromEntries(ids.map((id) => [envName(id), `{{secret.${id}}}`])),
        params: {},
        timeoutS: 120,
        approval: "always",
        ...(remote ? { ssh: remote } : {}),
      };
      const asked = keyId && !ids.includes(keyId) ? [...ids, keyId] : ids;
      const secrets = await this.collect(asked, {
        requester,
        purposeBase: FREE,
        frame: {
          approval: "always",
          command: input.command,
          secrets: ids,
          ...(input.host ? { host: input.host } : {}),
        },
      });
      const found: Found = { action, source: "app", scope: "", base: this.baseOf() };
      return await this.execute(found, {}, secrets, requester, asked, keyId);
    } finally {
      line?.cleanup();
    }
  }

  runs(input: {
    projectId?: string | undefined;
    name?: string | undefined;
    limit?: number | undefined;
  }): ActionRunInfo[] {
    const rows = this.opts.db
      .query(
        `SELECT * FROM action_runs
         WHERE (?1 IS NULL OR scope = ?1) AND (?2 IS NULL OR name = ?2)
         ORDER BY rowid DESC LIMIT ?3`,
      )
      .all(input.projectId ?? null, input.name ?? null, input.limit ?? 50) as RunRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      projectId: row.scope || null,
      requestedBy: row.requested_by,
      startedAt: row.started_at,
      durationMs: row.duration_ms,
      exitCode: row.exit_code,
      timedOut: row.timed_out === 1,
      truncated: row.truncated === 1,
      output: row.output,
    }));
  }

  // --- what is there ---

  private baseOf(projectId?: string): string {
    return projectId ? this.opts.projects(projectId).path : (this.opts.hostBase ?? homedir());
  }

  private appActions(scope: string, base: string): Found[] {
    const rows = this.opts.db
      .query("SELECT definition FROM actions WHERE scope = ? ORDER BY name")
      .all(scope) as Array<{ definition: string }>;
    return rows.map((row) => ({
      action: JSON.parse(row.definition) as ActionDef,
      source: "app",
      scope,
      base,
    }));
  }

  /** `.flightdeck/actions.yaml` as committed on the base branch; never the worktree. */
  private async versioned(project: ActionProject): Promise<{ found: Found[]; errors: string[] }> {
    const listed = must(
      await git(project.path, "ls-tree", "--name-only", project.baseBranch, "--", ACTIONS_FILE),
      "git ls-tree",
    );
    if (!listed.stdout.trim()) return { found: [], errors: [] };
    const shown = must(
      await git(project.path, "show", `${project.baseBranch}:${ACTIONS_FILE}`),
      "git show",
    );
    const { actions, errors } = parseActions(shown.stdout);
    return {
      found: actions.map((action) => ({
        action,
        source: "versioned",
        scope: project.id,
        base: project.path,
      })),
      errors,
    };
  }

  /** What a project sees: its own actions, the versioned ones, then the host's; the first name wins. */
  private async visible(projectId?: string): Promise<{ found: Found[]; errors: string[] }> {
    const host = this.appActions("", this.baseOf());
    if (!projectId) return { found: host, errors: [] };
    const project = this.opts.projects(projectId);
    const versioned = await this.versioned(project);
    const all = [...this.appActions(projectId, project.path), ...versioned.found, ...host];
    const seen = new Set<string>();
    const found = all.filter((f) => !seen.has(f.action.name) && seen.add(f.action.name));
    return {
      found: found.sort((a, b) => a.action.name.localeCompare(b.action.name)),
      errors: versioned.errors,
    };
  }

  private async find(projectId: string | undefined, name: string): Promise<Found> {
    const { found } = await this.visible(projectId);
    const one = found.find((f) => f.action.name === name);
    if (!one) throw new FlightdeckError("not_found", `a ação ${name} não existe`);
    return one;
  }

  // --- trust ---

  private trustRow(found: Found): Fingerprint | undefined {
    const row = this.opts.db
      .query("SELECT declaration, files FROM action_trust WHERE scope = ? AND name = ?")
      .get(found.scope, found.action.name) as TrustRow | null;
    return row ? { declaration: row.declaration, files: JSON.parse(row.files) } : undefined;
  }

  private pin(found: Found): void {
    const print = fingerprint(found.action, found.base);
    this.opts.db
      .query(
        `INSERT INTO action_trust (scope, name, declaration, files, trusted_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (scope, name) DO UPDATE SET declaration = excluded.declaration,
           files = excluded.files, trusted_at = excluded.trusted_at`,
      )
      .run(found.scope, found.action.name, print.declaration, JSON.stringify(print.files), now());
  }

  /** Refuses an action not trusted, or whose declaration or executed files changed since. */
  private assertTrusted(found: Found): void {
    const name = found.action.name;
    const trusted = this.trustRow(found);
    if (!trusted) throw invalid(`a ação ${name} não está confiada: revise e confie nela antes`);
    const changed = changes(trusted, fingerprint(found.action, found.base));
    if (changed.length > 0) {
      throw invalid(
        `a ação ${name} mudou desde que foi confiada (${changed.join(", ")}): confie de novo depois de revisar`,
      );
    }
  }

  private info(found: Found): ActionInfo {
    const { action } = found;
    const print = fingerprint(action, found.base);
    const trusted = this.trustRow(found);
    const changed = trusted ? changes(trusted, print) : [];
    return {
      name: action.name,
      description: action.description,
      source: found.source,
      projectId: found.scope || null,
      host: action.host ?? null,
      ssh: action.ssh ?? null,
      run: action.run,
      cwd: action.cwd ?? null,
      env: action.env,
      params: Object.fromEntries(
        Object.entries(action.params).map(([key, spec]) => [
          key,
          { pattern: spec.pattern, default: spec.default ?? null },
        ]),
      ),
      timeoutS: action.timeoutS,
      approval: approvalOf(action),
      tags: action.tags ?? [],
      secrets: secretsOf(action),
      trusted: trusted !== undefined && changed.length === 0,
      changed,
      hash: print.declaration,
    };
  }

  // --- secrets ---

  /** The requester, if it is one that may ask the app for a secret. */
  private permit(requester: VaultRequester): VaultDaemonRequester {
    const decision = decideRequest({ requester });
    if (!decision.granted) throw invalid(`pedido recusado: ${decision.reason}`);
    return decision.requester;
  }

  /** The values, by id. The user's own run finds them delivered; anyone else's is asked of the app. */
  private async collect(ids: string[], ask: Ask): Promise<Record<string, string>> {
    const secrets: Record<string, string> = {};
    for (const id of ids) {
      secrets[id] =
        ask.requester === "you"
          ? this.opts.vault.take(id, `${ask.purposeBase}:you`)
          : await this.request(id, { ...ask, requester: this.permit(ask.requester) });
    }
    return secrets;
  }

  /** Asks the app for one secret, for this request only, and waits for the delivery or the no. */
  private async request(
    secretId: string,
    ask: Ask & { requester: VaultDaemonRequester },
  ): Promise<string> {
    if (this.listeners.size === 0) {
      throw invalid("o app não está conectado: ele precisa estar aberto para liberar o segredo");
    }
    const requestId = ulid();
    const purpose = `${ask.purposeBase}:${requestId}`;
    const waiting = { controller: new AbortController(), denied: false };
    this.pending.set(requestId, waiting);
    // The wait is set up before the frame goes out, so a delivery cannot slip past it.
    const value = this.opts.vault.waitFor(
      secretId,
      purpose,
      this.opts.requestTimeoutMs ?? 120_000,
      waiting.controller.signal,
    );
    this.emit({
      ...ask.frame,
      type: "vault.request",
      requestId,
      secretId,
      purpose,
      requester: ask.requester,
    });
    try {
      return await value;
    } catch (error) {
      if (waiting.denied) throw invalid(`o app recusou o segredo ${secretId}`);
      throw error;
    } finally {
      this.pending.delete(requestId);
    }
  }

  private emit(frame: ActionsFrame): void {
    for (const listener of this.listeners) listener(frame);
  }

  // --- running and recording ---

  private async execute(
    found: Found,
    params: Record<string, string>,
    secrets: Record<string, string>,
    requester: VaultRequester,
    ids: string[],
    keyId: string | null = null,
  ): Promise<ActionResult> {
    const startedAt = now();
    const result: RunResult = await runAction(found.action, params, secrets, {
      base: found.base,
      ...(this.opts.baseEnv ? { baseEnv: this.opts.baseEnv } : {}),
      ...(this.opts.ssh ? { ssh: this.opts.ssh } : {}),
      ...(keyId ? { sshKey: { id: keyId, value: secrets[keyId] as string } } : {}),
    });
    const runId = ulid();
    this.opts.db
      .query(
        `INSERT INTO action_runs
           (id, scope, name, requested_by, started_at, duration_ms, exit_code, timed_out, truncated, output)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        found.scope,
        found.action.name,
        requester,
        startedAt,
        result.durationMs,
        result.exitCode,
        result.timedOut ? 1 : 0,
        result.truncated ? 1 : 0,
        result.output,
      );
    // For the app's usage log: who, for what, when; never the value.
    for (const secretId of ids) {
      this.emit({
        type: "vault.used",
        secretId,
        purpose: found.action.name === FREE ? FREE : `action:${found.action.name}`,
        requester,
        action: "run",
        at: now(),
      });
    }
    return { runId, ...result };
  }
}

/** `deploy-token` → `DEPLOY_TOKEN`. */
function envName(secretId: string): string {
  const name = secretId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return /^[0-9]/.test(name) ? `_${name}` : name;
}
