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
import type {
  ActionInfo,
  ActionList,
  ActionResult,
  ActionRunInfo,
  VaultDecisionInfo,
  VaultReportRow,
  VaultRequester,
  VaultVerdict,
} from "@flightdeck/protocol";
import { ulid } from "../kernel/index.ts";
import { ActionCatalog, type ActionProject, type Found } from "./catalog.ts";
import type { Approval } from "./domain/approval-check.ts";
import { FREE, freeAction, freeRemote, freeSecretIds } from "./domain/free-command.ts";
import { resolveParams } from "./domain/run-params.ts";
import { type RunRow, runInfoOf } from "./domain/run-row.ts";
import { approvalOf, secretsOf } from "./domain/schema.ts";
import { type RunResult, runAction, type SshExecutor } from "./run.ts";
import {
  type ActionsFrame,
  invalid,
  SecretRequests,
  type SecretRequestsOptions,
} from "./secret-requests.ts";
import { shellLine } from "./shell.ts";

export { type ActionsFrame, REQUEST_TTL_MS } from "./secret-requests.ts";

export interface ActionsOptions extends SecretRequestsOptions {
  /** The project by id; throws `not_found` for one that does not exist. */
  projects: (id: string) => ActionProject;
  /** Where host actions (and free commands) run; the home folder when absent. */
  hostBase?: string;
  /** The daemon's environment; what reaches a program is cleaned. */
  baseEnv?: Record<string, string | undefined>;
  /** The SSH destinations of phase 15 plug in here. */
  ssh?: SshExecutor;
  /** The vault secret that holds a destino's key (`vault-key`), or null when it has none. */
  sshKey?: (target: string) => string | null;
  /** Phase 19: the tags of an ssh destino (phase 15), which count in a use's tags. */
  sshTags?: (target: string) => string[];
  /** The `projectKey` of a project, as the rules' `project` matches it. */
  projectKey?: (projectId: string) => string | undefined;
}

const now = () => new Date().toISOString();

export class Actions {
  private readonly requests: SecretRequests;
  private readonly catalog: ActionCatalog;

  constructor(private readonly opts: ActionsOptions) {
    this.requests = new SecretRequests(opts);
    this.catalog = new ActionCatalog(opts);
  }

  /** The app's stream of `vault.request` and `vault.used` frames; answers how to stop it. */
  watch(listener: (frame: ActionsFrame) => void): () => void {
    return this.requests.watch(listener);
  }

  /** The user refused a request: the run that waits for it fails at once. */
  deny(requestId: string): void {
    this.requests.deny(requestId);
  }

  /** The user approved a request that asked; the delivery of its secret is allowed after this. */
  approve(requestId: string, approval: Approval): void {
    this.requests.approve(requestId, approval);
  }

  /** Throws unless a delivery for `purpose` may go through: a request that asks has to be approved. */
  gate(purpose: string): void {
    this.requests.gate(purpose);
  }

  /** The rules of a secret, replaced whole (the ones that break the ceiling are refused). */
  setRules(secretId: string, tags: readonly string[], rules: unknown): number {
    if (!this.opts.rules) throw invalid("usage rules are unavailable", "usage_rules_unavailable");
    return this.opts.rules.set(secretId, tags, rules);
  }

  getRules(secretId: string) {
    if (!this.opts.rules) throw invalid("usage rules are unavailable", "usage_rules_unavailable");
    return this.opts.rules.get(secretId);
  }

  /** The verdict for a use, without recording anything. */
  preview(use: Parameters<SecretRequests["preview"]>[0]): VaultVerdict {
    return this.requests.preview(use);
  }

  decisions(input: { secretId?: string; days?: number; limit?: number }): VaultDecisionInfo[] {
    return this.requests.decisions(input);
  }

  report(input: { days?: number; format?: "json" | "csv" }): {
    rows: VaultReportRow[];
    csv?: string;
  } {
    return this.requests.report(input);
  }

  /** Nothing that waits outlives the daemon. */
  stop(): void {
    this.requests.stop();
  }

  /** The actions a project sees (its own, then the host's) or, with no project, the host's. */
  list(projectId?: string): Promise<ActionList> {
    return this.catalog.list(projectId);
  }

  save(input: {
    projectId?: string;
    definition: Record<string, unknown>;
    secretIds?: string[];
  }): Promise<ActionInfo> {
    return this.catalog.save(input);
  }

  remove(projectId: string | undefined, name: string): Promise<ActionList> {
    return this.catalog.remove(projectId, name);
  }

  /** Trusts the action as it is now; `hash` is the declaration the user reviewed. */
  trust(projectId: string | undefined, name: string, hash: string): Promise<ActionInfo> {
    return this.catalog.trust(projectId, name, hash);
  }

  async run(input: {
    projectId?: string;
    name: string;
    params?: Record<string, string>;
    requestedBy: VaultRequester;
    session?: string;
  }): Promise<ActionResult> {
    const found = await this.catalog.find(input.projectId, input.name);
    await this.catalog.assertTrusted(found);
    const params = resolveParams(found.action, input.params ?? {});
    const { values, files } = secretsOf(found.action);
    // A destino that logs in with a key from the vault: the key is asked for like the secrets.
    const keyId = found.action.ssh ? (this.opts.sshKey?.(found.action.ssh) ?? null) : null;
    const ids = [...new Set([...values, ...files, ...(keyId ? [keyId] : [])])];
    const project = found.scope ? this.opts.projectKey?.(found.scope) : undefined;
    const secrets = await this.requests.collect(ids, {
      requester: input.requestedBy,
      purposeBase: `action:${found.action.name}`,
      frame: { action: found.action.name, params, approval: approvalOf(found.action) },
      use: {
        purpose: "action",
        action: found.action.name,
        // The ssh destino's tags count too (a prod destino asks at every use, held).
        tags: [
          ...(found.action.tags ?? []),
          ...(found.action.ssh ? (this.opts.sshTags?.(found.action.ssh) ?? []) : []),
        ],
        command: found.action.run.join(" "),
        cwd: found.base,
        ...(found.action.approval ? { actionApproval: found.action.approval } : {}),
        ...(project ? { project } : {}),
        ...(input.session ? { session: input.session } : {}),
      },
    });
    // The approval can take a while: what the action executes is checked again before it starts.
    await this.catalog.assertTrusted(found);
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
    host?: string;
    requestedBy: VaultRequester;
    session?: string;
  }): Promise<ActionResult> {
    const requester = this.requests.permit(input.requestedBy);
    const remote = freeRemote(input.host, Boolean(this.opts.ssh));
    const ids = freeSecretIds(input.secrets);
    const line = remote ? null : await shellLine(input.command, process.platform);
    const keyId = remote ? (this.opts.sshKey?.(remote) ?? null) : null;
    try {
      const action = freeAction({ command: input.command, ids, argv: line?.argv ?? null, remote });
      const asked = keyId && !ids.includes(keyId) ? [...ids, keyId] : ids;
      const secrets = await this.requests.collect(asked, {
        requester,
        purposeBase: FREE,
        frame: {
          approval: "always",
          command: input.command,
          secrets: ids,
          ...(input.host ? { host: input.host } : {}),
        },
        use: {
          purpose: "run_with_secret",
          tags: remote ? (this.opts.sshTags?.(remote) ?? []) : [],
          command: input.command,
          cwd: this.catalog.baseOf(),
          ...(input.session ? { session: input.session } : {}),
        },
      });
      const found: Found = { action, source: "app", scope: "", base: this.catalog.baseOf() };
      return await this.execute(found, {}, secrets, requester, asked, keyId);
    } finally {
      await line?.cleanup();
    }
  }

  runs(input: { projectId?: string; name?: string; limit?: number }): ActionRunInfo[] {
    const rows = this.opts.db
      .query(
        `SELECT * FROM action_runs
         WHERE (?1 IS NULL OR scope = ?1) AND (?2 IS NULL OR name = ?2)
         ORDER BY rowid DESC LIMIT ?3`,
      )
      .all(input.projectId ?? null, input.name ?? null, input.limit ?? 50) as RunRow[];
    return rows.map(runInfoOf);
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
      this.requests.emit({
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
