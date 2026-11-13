import type { Database } from "bun:sqlite";
import type { PermissionUpdate } from "@flightdeck/protocol";
import { FlightdeckError } from "../kernel/index.ts";
import { isProjectRule } from "../permissions/index.ts";
import { addRules, LOCAL_SETTINGS, readRules, removeRule, ruleString } from "./project-rules.ts";
import type { Card, Project } from "./types.ts";
import { excludeLocalSettingsAsync } from "./worktree.ts";

/** What the rule writes reach of the board (issue #1523). */
export interface RuleWritesPort {
  db: Database;
  project(id: string): Project;
  card(id: string): Card;
  /** The card changed: the board announces it. */
  changed(id: string): unknown;
}

/**
 * Issue #1523 (the board split): the project rules a card's session
 * accepts, written to the repository's settings one after the other, and the person's list of
 * them. The file helpers live in `project-rules.ts`.
 */
export class RuleWrites {
  /** The rule files being written, one after the other: two writes never read the same file. */
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly port: RuleWritesPort) {}

  /** A session accepted `updates`: its project rules are written after the ones before. */
  queue(sessionId: string, updates: PermissionUpdate[]): void {
    this.writes = this.writes.then(() => this.apply(sessionId, updates));
  }

  /** Resolves when every rule accepted so far is in its file. */
  written(): Promise<void> {
    return this.writes;
  }

  /** The project's rules: `permissions.allow` of its root `.claude/settings.local.json`. */
  list(projectId: string): Promise<string[]> {
    return readRules(this.port.project(projectId).path);
  }

  /** Removes one rule of the project, keeping the rest of the file; only with `confirm`. */
  async remove(projectId: string, rule: string, confirm: boolean): Promise<string[]> {
    if (!confirm) {
      throw new FlightdeckError(
        "invalid_state",
        "confirm removing the rule",
        "rule_remove_confirm",
      );
    }
    return removeRule(this.port.project(projectId).path, rule);
  }

  /**
   * Project rules accepted in a card's session (its run or a workflow step) also go to the
   * repository root's settings.local.json, which every new worktree of the project copies.
   */
  private async apply(sessionId: string, updates: PermissionUpdate[]): Promise<void> {
    const rules = updates.filter(isProjectRule).flatMap((update) => update.rules.map(ruleString));
    const card = this.port.db
      .query<{ card_id: string }, [string, string]>(
        `SELECT card_id FROM card_runs WHERE session_id = ?1
         UNION SELECT r.card_id FROM step_runs s JOIN workflow_runs r ON r.id = s.run_id
         WHERE s.session_id = ?2 LIMIT 1`,
      )
      .get(sessionId, sessionId);
    if (rules.length === 0 || !card) return;
    try {
      const repo = this.port.project(this.port.card(card.card_id).projectId).path;
      await excludeLocalSettingsAsync(repo);
      await addRules(repo, rules);
    } catch (error) {
      const notice = `regra não gravada no ${LOCAL_SETTINGS}: ${(error as Error).message}`;
      this.port.db.query("UPDATE cards SET notice = ? WHERE id = ?").run(notice, card.card_id);
      this.port.changed(card.card_id);
    }
  }
}
