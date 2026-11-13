/**
 * The actions' catalog (#1589): which actions a project or the host sees (the app's own, the ones
 * committed on the base branch, then the host's), and the user's trust in each, pinned to what it
 * executes. The service in `actions.ts` asks it for an action by name before it runs one.
 */
import type { Database } from "bun:sqlite";
import type { ActionInfo, ActionList, RuleIssue } from "@flightdeck/protocol";
import { must } from "../board/worktree.ts";
import { userHome } from "../config.ts";
import { git } from "../git/index.ts";
import { FlightdeckError, refArg } from "../kernel/index.ts";
import { definitionOf, pinnedFilesOf } from "./row-json.ts";
import { type ActionDef, approvalOf, parseActions, secretsOf, validateAction } from "./schema.ts";
import { changes, type Fingerprint, fingerprint } from "./trust.ts";

/** What the service needs to know of a project. */
export interface ActionProject {
  id: string;
  path: string;
  baseBranch: string;
}

/** What the catalog reads: the database, the projects and the host's folder. */
export interface CatalogOptions {
  db: Database;
  /** The project by id; throws `not_found` for one that does not exist. */
  projects: (id: string) => ActionProject;
  /** Where host actions (and free commands) run; the home folder when absent. */
  hostBase?: string;
}

/** Versioned actions live here, read from the project's base branch only. */
export const ACTIONS_FILE = ".flightdeck/actions.yaml";

const invalid = (message: string, reason?: string, params?: Record<string, string | number>) =>
  new FlightdeckError("invalid_state", message, reason, params);
const now = () => new Date().toISOString();

/** An action and where it came from. */
export interface Found {
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

export class ActionCatalog {
  constructor(private readonly opts: CatalogOptions) {}

  /** The actions a project sees (its own, then the host's) or, with no project, the host's. */
  async list(projectId?: string): Promise<ActionList> {
    const { found, errors, issues } = await this.visible(projectId);
    return { actions: await Promise.all(found.map((f) => this.info(f))), errors, issues };
  }

  async save(input: {
    projectId?: string;
    definition: Record<string, unknown>;
    secretIds?: string[];
  }): Promise<ActionInfo> {
    const { action, errors, issues } = validateAction(
      input.definition,
      input.secretIds ? { secretIds: new Set(input.secretIds) } : {},
    );
    if (!action) {
      throw new FlightdeckError(
        "bad_request",
        errors.join("; "),
        "action_invalid",
        undefined,
        issues,
      );
    }
    const scope = input.projectId ?? "";
    const base = this.baseOf(input.projectId);
    this.opts.db
      .query(
        `INSERT INTO actions (scope, name, definition, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (scope, name) DO UPDATE SET definition = excluded.definition`,
      )
      .run(scope, action.name, JSON.stringify(action), now());
    // What the app creates is trusted as it is saved; a later change to what it executes is not.
    await this.pin({ action, source: "app", scope, base });
    return await this.info({ action, source: "app", scope, base });
  }

  async remove(projectId: string | undefined, name: string): Promise<ActionList> {
    const scope = projectId ?? "";
    this.baseOf(projectId);
    const removed = this.opts.db
      .query("DELETE FROM actions WHERE scope = ? AND name = ?")
      .run(scope, name);
    if (removed.changes === 0)
      throw new FlightdeckError("not_found", `action ${name} does not exist`, "action_not_found", {
        action: name,
      });
    this.opts.db.query("DELETE FROM action_trust WHERE scope = ? AND name = ?").run(scope, name);
    return this.list(projectId);
  }

  /** Trusts the action as it is now; `hash` is the declaration the user reviewed. */
  async trust(projectId: string | undefined, name: string, hash: string): Promise<ActionInfo> {
    const found = await this.find(projectId, name);
    if ((await fingerprint(found.action, found.base)).declaration !== hash) {
      throw invalid(
        `action ${name} changed; review it again before trusting it`,
        "action_changed_review",
        {
          action: name,
        },
      );
    }
    await this.pin(found);
    return await this.info(found);
  }

  // --- what is there ---

  baseOf(projectId?: string): string {
    return projectId ? this.opts.projects(projectId).path : (this.opts.hostBase ?? userHome());
  }

  private appActions(scope: string, base: string): Found[] {
    const rows = this.opts.db
      .query("SELECT definition FROM actions WHERE scope = ? ORDER BY name")
      .all(scope) as Array<{ definition: string }>;
    return rows.map((row) => ({
      action: definitionOf(row.definition),
      source: "app",
      scope,
      base,
    }));
  }

  /** `.flightdeck/actions.yaml` as committed on the base branch; never the worktree. */
  private async versioned(
    project: ActionProject,
  ): Promise<{ found: Found[]; errors: string[]; issues: RuleIssue[] }> {
    const listed = must(
      await git(
        project.path,
        "ls-tree",
        "--name-only",
        "--end-of-options",
        refArg(project.baseBranch),
        "--",
        ACTIONS_FILE,
      ),
      "git ls-tree",
    );
    if (!listed.stdout.trim()) return { found: [], errors: [], issues: [] };
    const shown = must(
      await git(
        project.path,
        "show",
        "--end-of-options",
        `${refArg(project.baseBranch)}:${ACTIONS_FILE}`,
      ),
      "git show",
    );
    const { actions, errors, issues } = parseActions(shown.stdout);
    return {
      found: actions.map((action) => ({
        action,
        source: "versioned",
        scope: project.id,
        base: project.path,
      })),
      errors,
      issues,
    };
  }

  /** What a project sees: its own actions, the versioned ones, then the host's; the first name wins. */
  private async visible(
    projectId?: string,
  ): Promise<{ found: Found[]; errors: string[]; issues: RuleIssue[] }> {
    const host = this.appActions("", this.baseOf());
    if (!projectId) return { found: host, errors: [], issues: [] };
    const project = this.opts.projects(projectId);
    const versioned = await this.versioned(project);
    const all = [...this.appActions(projectId, project.path), ...versioned.found, ...host];
    const seen = new Set<string>();
    const found = all.filter((f) => !seen.has(f.action.name) && seen.add(f.action.name));
    found.sort((a, b) => a.action.name.localeCompare(b.action.name));
    return {
      found,
      errors: versioned.errors,
      issues: versioned.issues,
    };
  }

  async find(projectId: string | undefined, name: string): Promise<Found> {
    const { found } = await this.visible(projectId);
    const one = found.find((f) => f.action.name === name);
    if (!one)
      throw new FlightdeckError("not_found", `action ${name} does not exist`, "action_not_found", {
        action: name,
      });
    return one;
  }

  // --- trust ---

  private trustRow(found: Found): Fingerprint | undefined {
    const row = this.opts.db
      .query("SELECT declaration, files FROM action_trust WHERE scope = ? AND name = ?")
      .get(found.scope, found.action.name) as TrustRow | null;
    return row ? { declaration: row.declaration, files: pinnedFilesOf(row.files) } : undefined;
  }

  private async pin(found: Found): Promise<void> {
    const print = await fingerprint(found.action, found.base);
    this.opts.db
      .query(
        `INSERT INTO action_trust (scope, name, declaration, files, trusted_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (scope, name) DO UPDATE SET declaration = excluded.declaration,
           files = excluded.files, trusted_at = excluded.trusted_at`,
      )
      .run(found.scope, found.action.name, print.declaration, JSON.stringify(print.files), now());
  }

  /** Refuses an action not trusted, or whose declaration or executed files changed since. */
  async assertTrusted(found: Found): Promise<void> {
    const name = found.action.name;
    const trusted = this.trustRow(found);
    if (!trusted)
      throw invalid(
        `action ${name} is not trusted: review and trust it first`,
        "action_not_trusted",
        {
          action: name,
        },
      );
    const changed = changes(trusted, await fingerprint(found.action, found.base));
    if (changed.length > 0) {
      throw invalid(
        `action ${name} changed since it was trusted (${changed.join(", ")}): trust it again after reviewing`,
        "action_changed_since_trust",
        { action: name, changes: changed.join(", ") },
      );
    }
  }

  private async info(found: Found): Promise<ActionInfo> {
    const { action } = found;
    const print = await fingerprint(action, found.base);
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
}
