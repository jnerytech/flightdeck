/** Stub. */
import type { Database } from "bun:sqlite";
import type { Automation, AutomationRun, Issue } from "@flightdeck/protocol";
import type { Board } from "../board/board.ts";
import type { Issues } from "../issues/issues.ts";
import type { AutoApprover } from "../permissions/auto-approve.ts";

export type AutomationEvent =
  | {
      type: "pr_comment";
      cardId: string;
      commentId: string;
      author: string;
      text: string;
      /** Third party: not you, and not an owner, member or collaborator. */
      external: boolean;
    }
  | { type: "ci_failed"; cardId: string; key: string; summary: string }
  | { type: "issue_label"; projectId: string; issue: Issue }
  | { type: "cron"; projectId: string; automationId: string; minute: number };

export interface AutomationInput {
  projectId: string;
  id?: string | undefined;
  name: string;
  trigger: Automation["trigger"];
  action: Automation["action"];
  maxRunsPerDay?: number | undefined;
  allowExternalAuthors?: boolean | undefined;
}

export interface AutomationsOptions {
  db: Database;
  board: Board;
  issues: Pick<Issues, "list" | "createCard">;
  autoApprove?: Pick<AutoApprover, "suspend">;
  /** Milliseconds now; `Date.now` when absent. */
  clock?: () => number;
  /** `YYYY-MM-DD` of an instant, for the daily limit; the host's time zone when absent. */
  day?: (ms: number) => string;
  /** The scheduler's interval (a minute when absent). */
  tickMs?: number;
  /** The issue search's interval (5 minutes when absent). */
  pollMs?: number;
  log?: (message: string) => void;
}

/** Stub. */
export class Automations {
  constructor(readonly opts: AutomationsOptions) {}

  list(_projectId: string): Automation[] {
    return [];
  }

  save(input: AutomationInput): Automation {
    return {
      id: "stub",
      projectId: input.projectId,
      name: input.name,
      enabled: true,
      trigger: input.trigger,
      action: input.action,
      maxRunsPerDay: 0,
      allowExternalAuthors: true,
      createdAt: "",
    };
  }

  remove(_id: string, _confirm: boolean): Automation[] {
    return [];
  }

  toggle(id: string, enabled: boolean, _confirm: boolean): Automation {
    return {
      ...this.save({
        projectId: "",
        name: "",
        trigger: { type: "pr_comment" },
        action: { type: "send_to_card" },
      }),
      id,
      enabled: !enabled,
    };
  }

  runs(_id: string, _limit = 100): AutomationRun[] {
    return [];
  }

  async fire(_event: AutomationEvent): Promise<void> {}

  onChecksFailing(_cardId: string, _failed: string[]): void {}

  async tick(_now: number): Promise<void> {}

  async pollIssues(): Promise<void> {}

  start(): void {}

  stop(): void {}
}
