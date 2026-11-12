import type { Database } from "bun:sqlite";
import {
  type ContractOverrides,
  inSequence,
  PersonaRef,
  specExpectedPath,
} from "@flightdeck/protocol";
import { FlightdeckError, refusalOf } from "../errors.ts";
import { parseJsonWith } from "../kernel/index.ts";
import { withoutPersonas } from "../personas/prepare.ts";
import { folderRemoving } from "../worktrees/locks.ts";
import type { BoardEvent } from "./columns.ts";
import { git } from "./command.ts";
import { pinnedPrompt } from "./pins.ts";
import { refArg } from "./ref-arg.ts";
import { runSetup } from "./setup.ts";
import {
  hasTddSkill,
  renderSpec,
  specFirstLine,
  type TemplateIgnored,
  type TemplateName,
  wantsSpec,
  writeSpec,
} from "./spec-template.ts";
import {
  addWorktree,
  excludeLocalSettingsAsync,
  freshBase,
  must,
  WORKTREE_INCLUDE_LIMIT,
} from "./worktree.ts";

export { DEFAULT_PROMPT_TEMPLATE } from "./projects.ts";
export type { FixResult } from "./session-follow.ts";

import type { WorkflowEngine } from "../workflows/engine.ts";
import type { CheckLoopEngine } from "./check-loop-engine.ts";
import type { FixResult } from "./session-follow.ts";
import type { BoardOptions, Card, Project, RunRow } from "./types.ts";

const now = () => new Date().toISOString();

/** Issue #1523: the notice of a done card whose worktree kept changes; the board reads it back. */
export const PENDING_NOTICE = "worktree com alterações pendentes: não foi removida";

/** The notice for files the worktree copy left out because they passed the size limit. */
function skippedNotice(left: number, limit: number): string {
  const files =
    left === 1
      ? "1 arquivo do .worktreeinclude não copiado"
      : left + " arquivos do .worktreeinclude não copiados";
  return `${files}: passou do limite de ${Math.round((limit / 1024 / 1024) * 100) / 100} MB`;
}

/** What launching and ending a card's runs reaches of the board (issue #1523). */
export interface LaunchPort {
  db: Database;
  opts: Pick<BoardOptions, "manager" | "worktreeIncludeLimit" | "folderLocks" | "preparePersonas">;
  workflows: Pick<WorkflowEngine, "fail" | "has" | "begin" | "abandon" | "closeSessions">;
  card(id: string): Card;
  project(id: string): Project;
  /** The card changed: the board announces it. */
  changed(id: string): unknown;
  place(id: string, event: BoardEvent): void;
  /** Frees the card's run slot. */
  release(id: string): void;
  setNotice(id: string, notice: string, why?: unknown): void;
  settleFix(id: string, result: Partial<FixResult>): void;
  follow(id: string, sessionId: string, sinceSeq: number): void;
  templateFor(
    cwd: string,
    name: TemplateName,
  ): Promise<{ body: string | null; ignored: TemplateIgnored | null }>;
  dropConflicts(id: string): void;
  loop(): CheckLoopEngine | null;
  /** Settles what a worktree waits for before it is removed. */
  settle(): Promise<void>;
}

/**
 * Issue #1523 (the board split): a run that left the queue gets its worktree, its setup, its
 * spec and its session; a run that cannot start fails on the card; a done card's runs close and
 * its clean worktree goes.
 */
export class Launcher {
  constructor(private readonly port: LaunchPort) {}

  /** Nothing reached the agent: the run ends and the card waits for the user with the error. */
  failRun(id: string, runId: string, notice: string, why?: unknown): void {
    this.port.settleFix(id, { isError: true, error: notice });
    this.port.workflows.fail(runId, notice, refusalOf(why));
    this.port.setNotice(id, notice, why);
    this.port.place(id, { type: "failed" });
    this.port.db.query("UPDATE card_runs SET ended_at = ? WHERE id = ?").run(now(), runId);
    this.port.changed(id);
    this.port.release(id);
  }

  async launch(id: string, runId: string): Promise<void> {
    const card = this.port.card(id);
    const project = this.port.project(card.projectId);
    let worktree = card.worktreePath;
    if (!worktree) {
      const limit = this.port.opts.worktreeIncludeLimit ?? WORKTREE_INCLUDE_LIMIT;
      // A card that waited for blockers starts from the base as it is after they merged.
      const from =
        card.blockedBy.length > 0
          ? await freshBase(project.path, refArg(project.baseBranch))
          : { ref: project.baseBranch, notice: null };
      const added = await addWorktree(project.path, card.title, from.ref, limit);
      worktree = added.path;
      const left = added.skipped.length;
      const skipped = left === 0 ? null : skippedNotice(left, limit);
      const notice = [from.notice, skipped].filter((part) => part !== null).join("; ") || null;
      this.port.db
        .query(
          "UPDATE cards SET slug = ?, branch = ?, worktree_path = ?, notice = ?, updated_at = ? WHERE id = ?",
        )
        .run(added.slug, added.branch, added.path, notice, now(), id);
      this.port.changed(id);
    }
    if (this.port.opts.folderLocks?.isHeld(worktree)) throw folderRemoving(worktree);
    await excludeLocalSettingsAsync(project.path);
    if (project.setupScript) await runSetup(project.setupScript, worktree);
    // The newest run is the active one: older sessions of the card are closed.
    await this.closeRuns(id, runId);
    // A workflow run executes its steps instead of sending the description to one session.
    if (this.port.workflows.has(runId)) return this.port.workflows.begin(runId, worktree);
    const specLine = this.firstSession(id, runId)
      ? await this.startSpec(id, project.contractByColumn, worktree)
      : null;
    const pins = await pinnedPrompt(worktree, card.pinnedDocs);
    const prompt = [card.description, specLine ?? "", pins, project.promptTemplate]
      .filter((part) => part.trim())
      .join("\n\n");
    const { variant } = card;
    const run = this.port.db
      .query<{ persona: string | null; fix_prompt: string | null }, [string]>(
        "SELECT persona, fix_prompt FROM card_runs WHERE id = ?",
      )
      .get(runId);
    const personaRef = run?.persona ? parseJsonWith(PersonaRef, run.persona) : undefined;
    const prepared = await (this.port.opts.preparePersonas ?? withoutPersonas)(
      personaRef,
      worktree,
    );
    const { sessionId } = await this.port.opts.manager.create(
      {
        cwd: worktree,
        prompt: run?.fix_prompt ?? prompt,
        name: card.title,
        ...(variant?.model ? { model: variant.model } : {}),
        ...(variant?.effort ? { effort: variant.effort } : {}),
        ...(variant?.permissionMode ? { permissionMode: variant.permissionMode } : {}),
        ...(personaRef ? { persona: personaRef } : {}),
      },
      { unattended: run?.fix_prompt != null, prepared },
    );
    this.port.db.query("UPDATE card_runs SET session_id = ? WHERE id = ?").run(sessionId, runId);
    this.port.changed(id);
    this.port.follow(id, sessionId, 0);
  }

  /**
   * Issue #78: on a card's first run, when its project asks for a spec, writes the spec from the
   * template into the new worktree (never over one that is there) and gives the line that sends the
   * session to it first. A spec that cannot be written is said on the card; the run starts anyway.
   */
  private async startSpec(
    id: string,
    contracts: ContractOverrides,
    worktree: string,
  ): Promise<string | null> {
    const card = this.port.card(id);
    const path = specExpectedPath(card);
    if (path === null || !wantsSpec(contracts, card.specPath)) return null;
    // A trusted project's own template, from its trusted checkout; anything else gets the built-in.
    const template = await this.port.templateFor(worktree, "spec");
    const result = await writeSpec(worktree, path, renderSpec(card, template.body ?? undefined));
    if (result === "failed") {
      // The app says it in its language; the prompt sends the agent to no spec that is not there.
      const why = new FlightdeckError(
        "invalid_state",
        `spec template not written: ${path}`,
        "spec_template_failed",
        { path },
      );
      this.port.setNotice(id, why.message, why);
      this.port.changed(id);
      return null;
    }
    const ignored = template.ignored;
    if (ignored && result === "written") {
      // The built-in template was used; the project's own is named by its reason, never quoted.
      const why = new FlightdeckError(
        "invalid_state",
        `the project's spec template was not used (${ignored})`,
        `spec_template_${ignored}`,
      );
      this.port.setNotice(id, why.message, why);
      this.port.changed(id);
    }
    return specFirstLine(path, await hasTddSkill(worktree));
  }

  /**
   * No earlier run of the card reached a session: the card's first start, the one a spec template
   * is for. A first start that failed before its session (a setup script) still counts as first.
   */
  private firstSession(id: string, runId: string): boolean {
    const earlier = this.port.db
      .query("SELECT 1 FROM card_runs WHERE card_id = ? AND id <> ? AND session_id IS NOT NULL")
      .get(id, runId);
    return earlier === null;
  }

  /** Closes the card's sessions and ends its open runs, except `keep` (the one launching). */
  async closeRuns(id: string, keep = ""): Promise<void> {
    const open = this.port.db
      .query<RunRow, [string, string]>(
        "SELECT * FROM card_runs WHERE card_id = ? AND id <> ? AND ended_at IS NULL",
      )
      .all(id, keep);
    await inSequence(open, async (run) => {
      if (run.session_id) await this.port.opts.manager.close(run.session_id);
      this.port.db.query("UPDATE card_runs SET ended_at = ? WHERE id = ?").run(now(), run.id);
    });
    this.port.workflows.abandon(id, "execução encerrada com o card", keep);
    await this.port.workflows.closeSessions(id, keep);
  }

  /** The card is done: sessions closed, worktree removed unless something is still pending. */
  async finish(id: string): Promise<void> {
    this.port.dropConflicts(id);
    // Issue #1361: the worktree goes only once a check killed in it has exited.
    await this.port.loop()?.onStop(id);
    await this.closeRuns(id);
    await this.removeCleanWorktree(id);
    this.port.changed(id);
  }

  private async removeCleanWorktree(id: string): Promise<void> {
    const card = this.port.card(id);
    if (!card.worktreePath) return;
    const pending = must(await git(card.worktreePath, "status", "--porcelain"), "git status");
    if (pending.stdout.trim()) {
      this.port.db.query("UPDATE cards SET notice = ? WHERE id = ?").run(PENDING_NOTICE, id);
      return;
    }
    const repo = this.port.project(card.projectId).path;
    await this.port.settle();
    must(await git(repo, "worktree", "remove", card.worktreePath), "git worktree remove");
    this.port.db.query("UPDATE cards SET worktree_path = NULL, notice = NULL WHERE id = ?").run(id);
  }
}
