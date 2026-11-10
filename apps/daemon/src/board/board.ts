import type { Database } from "bun:sqlite";
import { resolve } from "node:path";
import {
  type Arena,
  BoardColumn as BoardColumnSchema,
  type BoardResult,
  type CardTemplates,
  type EffortLevel,
  type PersonaRef,
  type RunResumeCheck,
  type SessionEvent,
  type WorkflowInfo,
  type WorkflowTemplate,
  type WorkflowTemplateAdded,
} from "@flightdeck/protocol";
import { FlightdeckError, refusalOf } from "../errors.ts";
import { UNTRUSTED_MARK } from "../issues/issues.ts";
import { isInside } from "../paths.ts";
import { type DoneVia, forgetDone, recordDone } from "../roi/done-log.ts";
import { shellCheckRunner } from "../workflows/check-runner.ts";
import { WorkflowEngine } from "../workflows/engine.ts";
import { addWorkflowTemplate } from "../workflows/template-add.ts";
import { Arenas } from "./arena.ts";
import { Blockers } from "./blockers.ts";
import { CardLifecycle } from "./card-lifecycle.ts";
import { CardPrFlow } from "./card-pr-flow.ts";
import { CardView } from "./card-view.ts";
import { Cards } from "./cards.ts";
import type { CheckLoopEngine } from "./check-loop-engine.ts";
import { CheckLoopHost } from "./check-loop-host.ts";
import { type BoardEvent, nextColumn } from "./columns.ts";
import { Launcher, PENDING_NOTICE } from "./launch.ts";
import { type PrComment, prProvider } from "./pr.ts";
import { PrPoll } from "./pr-poll.ts";
import { Projects } from "./projects.ts";
import { RadarFeed } from "./radar-feed.ts";
import { RuleWrites } from "./rule-writes.ts";
import { RunQueue } from "./run-queue.ts";
import { type FixResult, FREES_SLOT, SessionFollow } from "./session-follow.ts";
import type { TemplateIgnored, TemplateName } from "./spec-template.ts";
import type {
  BoardColumn,
  BoardOptions,
  Card,
  CardDiff,
  NewProject,
  Project,
  ProjectPatch,
  RunRow,
} from "./types.ts";

export { DEFAULT_PR_POLL_MS } from "./pr-poll.ts";
export { DEFAULT_PROMPT_TEMPLATE } from "./projects.ts";
export type { FixResult } from "./session-follow.ts";
export type { BoardOptions } from "./types.ts";

const now = () => new Date().toISOString();

/**
 * Projects (git repositories of this host) and their boards. A card is a thin layer over what
 * already exists: a branch, a worktree, a session and a PR.
 */

export class Board {
  private readonly db: Database;
  /** The projects and their rows (issue #1523). */
  private readonly projects: Projects;
  /** The project rules a card's session accepts, written in turn (issue #1523). */
  private readonly rules: RuleWrites;
  /** The sessions of the cards' active runs (issue #1523). */
  private readonly sessions: SessionFollow;
  /** The runs' slots and what holds the queue (issue #1523). */
  private readonly queue: RunQueue;
  /** Launching and ending the cards' runs (issue #1523). */
  private readonly launcher: Launcher;
  private readonly waits: Array<() => Promise<unknown>> = [];
  private readonly ends: Array<(cardId: string) => Promise<unknown>> = [];
  /** Moves, spec, stop, completion, discard and delete of a card (issue #1523). */
  private readonly lifecycle: CardLifecycle;
  /** Making, editing and starting cards (issue #1523). */
  private readonly cards: Cards;
  /** A card as the app sees it (issue #1523). */
  private readonly view: CardView;
  /** The PR polling: timer, rounds and reads of the open PRs (issue #1523). */
  private readonly prPoll: PrPoll;
  /** A card's diff, PR, PR comments, rebase and local merge (issue #1523). */
  private readonly prFlow: CardPrFlow;
  /** Set by stop(): the database may be closed, so a start still in flight writes nothing. */
  private stopped = false;
  private readonly watchers = new Set<(card: Card) => void>();
  /** Issue #1405: the conflict radar's reads and overlaps (issue #1523). */
  private readonly radarFeed: RadarFeed;
  /** The cards a card waits for (phase 31) and the gate before a start (issue #1523). */
  private readonly blockers: Blockers;
  /** Arenas: a card's variants, their comparison and the choice (issue #1523). */
  private readonly arenas: Arenas;
  /** Workflows of the projects and their runs (phase 6). */
  readonly workflows: WorkflowEngine;

  /** Issue #1361: the check loop's engine, switch and rounds (board/check-loop-host.ts). */
  private readonly loopHost: CheckLoopHost;

  constructor(private readonly opts: BoardOptions) {
    this.db = opts.db;
    this.radarFeed = new RadarFeed({
      db: opts.db,
      card: (id) => this.getCard(id),
      project: (id) => this.getProject(id),
      changed: (id) => this.changed(id),
      stopped: () => this.stopped,
    });
    this.blockers = new Blockers({
      db: opts.db,
      card: (id) => this.getCard(id),
      changed: (id) => this.changed(id),
      startCard: (id, options) => this.startCard(id, options),
      stopped: () => this.stopped,
      setNoticeReason: (id, why) => this.setNoticeReason(id, why),
    });
    this.projects = new Projects(opts.db, opts);
    this.queue = new RunQueue({
      db: opts.db,
      opts,
      project: (id) => this.getProject(id),
      changed: (id) => this.changed(id),
      launch: (cardId, runId) => this.launch(cardId, runId),
      failRun: (cardId, runId, notice, why) => this.failRun(cardId, runId, notice, why),
      stopped: () => this.stopped,
    });
    this.sessions = new SessionFollow({
      db: opts.db,
      manager: opts.manager,
      loop: () => this.loop,
      place: (cardId, event) => this.place(cardId, event),
      release: (cardId) => this.release(cardId),
      refreshConflicts: (cardId) => this.refreshConflicts(cardId),
      startCard: (id, options) => this.startCard(id, options),
      card: (id) => this.getCard(id),
    });
    this.rules = new RuleWrites({
      db: opts.db,
      project: (id) => this.getProject(id),
      card: (id) => this.getCard(id),
      changed: (id) => this.changed(id),
    });
    this.workflows = new WorkflowEngine({
      db: opts.db,
      manager: opts.manager,
      ...(opts.preparePersonas ? { preparePersonas: opts.preparePersonas } : {}),
      host: {
        place: (cardId, event) => this.place(cardId, event),
        release: (cardId) => this.release(cardId),
        hold: (cardId) => this.queue.hold(cardId),
        acquire: (cardId) => this.queue.acquire(cardId),
        takeSlots: (cardId, count) => this.queue.takeSlots(cardId, count),
        waitQuota: () => this.queue.waitQuota(),
        createPr: async (cardId) => (await this.createPr(cardId)).prUrl as string,
        raiseCards: (cardId, findings, origin) =>
          this.raiseCards(this.getCard(cardId).projectId, findings, origin),
        card: (cardId) => this.getCard(cardId),
      },
      checks: opts.checks ?? shellCheckRunner(),
      clock: opts.clock ?? Date.now,
    });
    this.arenas = new Arenas({
      db: opts.db,
      opts,
      workflows: this.workflows,
      card: (id) => this.getCard(id),
      changed: (id) => this.changed(id),
      place: (id, event) => this.place(id, event),
      refuseIfBlocked: (card) => this.blockers.refuseIfBlocked(card),
      queued: (id) => this.queue.has(id),
      createVariant: (projectId, input) => this.createCard(projectId, input),
      startCard: (id, options) => this.startCard(id, options),
      discardCard: (id, confirm) => this.discardCard(id, confirm),
      diff: (id) => this.diff(id),
      freesSlot: (status) => FREES_SLOT.has(status),
      unfollow: (id) => this.sessions.unfollow(id),
      follow: (id, sessionId, sinceSeq) => this.follow(id, sessionId, sinceSeq),
    });
    this.loopHost = new CheckLoopHost({
      db: opts.db,
      opts,
      workflows: this.workflows,
      card: (id) => this.getCard(id),
      project: (id) => this.getProject(id),
      budgetBlocked: (projectId) => this.budgetBlocked(projectId),
      release: (id) => this.release(id),
      place: (id, event) => this.place(id, event),
      changed: (id) => this.changed(id),
    });
    this.launcher = new Launcher({
      db: opts.db,
      opts,
      workflows: this.workflows,
      card: (id) => this.getCard(id),
      project: (id) => this.getProject(id),
      changed: (id) => this.changed(id),
      place: (id, event) => this.place(id, event),
      release: (id) => this.release(id),
      setNotice: (id, notice, why) => this.setNotice(id, notice, why),
      settleFix: (id, result) => this.settleFix(id, result),
      follow: (id, sessionId, sinceSeq) => this.follow(id, sessionId, sinceSeq),
      templateFor: (cwd, name) => this.templateFor(cwd, name),
      dropConflicts: (id) => this.dropConflicts(id),
      loop: () => this.loop,
      settle: () => this.settle(),
    });
    this.prFlow = new CardPrFlow({
      db: opts.db,
      opts,
      card: (id) => this.getCard(id),
      project: (id) => this.getProject(id),
      changed: (id) => this.changed(id),
      place: (id, event) => this.place(id, event),
      setNotice: (id, notice, why) => this.setNotice(id, notice, why),
      stopped: () => this.stopped,
      message: (id, text) => this.message(id, text),
      settle: () => this.settle(),
      closeRuns: (id) => this.closeRuns(id),
      loop: () => this.loop,
      armPoll: () => this.prPoll.arm(),
      readInFlight: (id) => this.prPoll.inFlight(id),
      pollPr: (id) => this.prPoll.pollPr(id),
    });
    this.prPoll = new PrPoll({
      db: opts.db,
      opts,
      card: (id) => this.getCard(id),
      project: (id) => this.getProject(id),
      changed: (id) => this.changed(id),
      place: (id, event) => this.place(id, event),
      setNotice: (id, notice, why) => this.setNotice(id, notice, why),
      finish: (id) => this.finish(id),
      stopped: () => this.stopped,
      fetchComments: (id) => this.prFlow.fetchComments(id),
      pendingNotice: PENDING_NOTICE,
    });
    this.cards = new Cards({
      db: opts.db,
      opts,
      workflows: this.workflows,
      card: (id) => this.getCard(id),
      project: (id) => this.getProject(id),
      changed: (id) => this.changed(id),
      place: (id, event) => this.place(id, event),
      queued: (id) => this.queue.has(id),
      pump: () => this.pump(),
      templateFor: (cwd, name, own) => this.templateFor(cwd, name, own),
      removeFromBoard: (id, verb) => this.lifecycle.removeFromBoard(id, verb),
      untrustedMark: UNTRUSTED_MARK,
      blockers: this.blockers,
    });
    this.lifecycle = new CardLifecycle({
      db: opts.db,
      opts,
      workflows: this.workflows,
      card: (id) => this.getCard(id),
      project: (id) => this.getProject(id),
      changed: (id) => this.changed(id),
      place: (id, event, via) => this.place(id, event, via),
      emit: (card) => this.emit(card),
      setNotice: (id, notice, why) => this.setNotice(id, notice, why),
      settleFix: (id, result) => this.settleFix(id, result),
      loop: () => this.loop,
      closeRuns: (id) => this.closeRuns(id),
      finish: (id) => this.finish(id),
      unfollow: (id) => this.sessions.unfollow(id),
      runEnds: (id) => Promise.all(this.ends.map((end) => end(id))),
      settle: () => this.settle(),
      variantIds: (id) => this.arenas.variantIds(id),
      dropConflicts: (id) => this.dropConflicts(id),
      blockers: this.blockers,
      stopped: () => this.stopped,
      forgetDone: (id) => forgetDone(this.db, id),
    });
    this.view = new CardView({
      db: opts.db,
      sessionStatus: (sessionId) => opts.manager.get(sessionId).status,
      mayConflictOf: (id) => this.radarFeed.mayConflictOf(id),
      isWorkflowRun: (runId) => this.workflows.has(runId),
      checkLoopOf: (row) => this.loopHost.of(row),
      blockers: this.blockers,
      queueState: (queued, projectId) => this.queue.queueState(queued, projectId),
    });
    opts.manager.onPermissionUpdates((sessionId, updates) => this.rules.queue(sessionId, updates));
    this.queue.watchLimits();
    this.prPoll.arm();
    // Issue #1361: a round a restart left open is closed; the loop never resumes by itself.
    this.loopHost.sweep();
    // Back from a restart: keep moving cards whose run still has a session.
    const active = this.db
      .query<RunRow, []>(
        "SELECT * FROM card_runs WHERE session_id IS NOT NULL AND ended_at IS NULL",
      )
      .all();
    for (const run of active) {
      const sessionId = run.session_id as string;
      this.follow(run.card_id, sessionId, opts.manager.get(sessionId).lastSeq);
    }
    // Workflow runs take their slots back before the queue moves.
    this.workflows.recover();
    // A blocker that finished while the daemon was down ends its dependents' wait now.
    for (const { id } of this.db
      .query<{ id: string }, []>("SELECT id FROM cards WHERE waiting = 1")
      .all()) {
      this.blockers.afterBlockerChange(id);
    }
    this.pump();
  }

  /**
   * The work a board begins once it is built, kept out of the constructor (Sonar S7059): the radar
   * starts empty, so it reads the cards that already have a worktree, one at a time.
   */
  start(): Promise<void> {
    return this.radarFeed.refreshAll().catch(() => {});
  }

  listProjects(): Project[] {
    return this.projects.list();
  }

  /** Phase 29: the project as it leaves for the app (see `Projects.forWire`). */
  forWire(project: Project): Promise<Project> {
    return this.projects.forWire(project);
  }

  getProject(id: string): Project {
    return this.projects.get(id);
  }

  /** Registers a git repository that lives inside `allowedRoots`. */
  addProject(input: NewProject): Promise<Project> {
    return this.projects.add(input);
  }

  updateProject(id: string, patch: ProjectPatch): Project {
    return this.projects.update(id, patch);
  }

  /**
   * Phase 13: the project a folder belongs to (its repository or a card's worktree), with the
   * card when it is one; null outside every project.
   */
  projectForCwd(cwd: string): { project: Project; card: Card | null } | null {
    const card = this.db
      .query<{ id: string; worktree_path: string }, []>(
        "SELECT id, worktree_path FROM cards WHERE worktree_path IS NOT NULL",
      )
      .all()
      .find((row) => isInside(resolve(row.worktree_path), resolve(cwd)));
    if (card) {
      const found = this.getCard(card.id);
      return { project: this.getProject(found.projectId), card: found };
    }
    const project = this.listProjects().find((p) => isInside(resolve(p.path), resolve(cwd)));
    return project ? { project, card: null } : null;
  }

  /**
   * Issue #79: raises the findings of a workflow's agent step as Backlog cards, skipping those a
   * card of the project already covers (by key, or by title among the open ones) and creating at
   * most `CARDS_PER_RUN`. The text is the agent's: marked as such, with approval kept off.
   */
  raiseCards(
    projectId: string,
    findings: Parameters<Cards["raiseCards"]>[1],
    origin: { workflow: string; runId: string },
  ): ReturnType<Cards["raiseCards"]> {
    return this.cards.raiseCards(projectId, findings, origin);
  }

  getCard(id: string): Card {
    return this.view.read(id);
  }

  /**
   * Issue #1201: the project's card templates (`.flightdeck/templates/cards.json`, trusted projects
   * only, read from the trusted checkout): the ones offered, how many entries were left out, and
   * why a file that is there was not used.
   */
  cardTemplates(projectId: string): Promise<CardTemplates> {
    return this.cards.cardTemplates(projectId);
  }

  /**
   * A new card, filled from one of the project's templates when `templateId` names one: its
   * workflow, persona, pins and spec file, and its text when the person typed none. A template the
   * project does not offer (or does not trust) refuses the card.
   */
  createCardFrom(
    projectId: string,
    input: Parameters<Cards["createCard"]>[1] & { templateId?: string },
  ): Promise<Card> {
    return this.cards.createCardFrom(projectId, input);
  }

  /** A new card goes to the end of the column it is born in: the Backlog unless it says another. */
  createCard(projectId: string, input: Parameters<Cards["createCard"]>[1]): Card {
    return this.cards.createCard(projectId, input);
  }

  /**
   * "Iniciar em arena": the same request in 2 to 4 variants. Each is a card of its own, hidden
   * from the board, with its own worktree (`fd/<slug>-a`, `-b`…), session, queue entry and
   * slot, so the arena takes one slot per variant and a variant without one waits its turn.
   * Model and effort apply to plain requests; a workflow defines its own.
   */
  startArena(
    cardId: string,
    input: {
      variants: Array<{
        model?: string;
        effort?: EffortLevel;
        persona?: PersonaRef;
      }>;
      workflow?: string;
      inputs?: Record<string, string>;
    },
  ): Promise<Arena> {
    return this.arenas.startArena(cardId, input);
  }

  /** The comparison: each variant's diff, workflow checks, cost, duration and state. */
  arena(cardId: string): Promise<Arena> {
    return this.arenas.arena(cardId);
  }

  /**
   * "Escolher": the variant becomes the card's worktree, branch and runs, and carries on as a
   * normal card; the other variants are stopped and removed. Only a variant that has stopped.
   */
  chooseVariant(cardId: string, variantId: string, confirm: boolean): Promise<Card> {
    return this.arenas.chooseVariant(cardId, variantId, confirm);
  }

  /** The card already made from an issue of the project, if any. */
  cardForIssue(projectId: string, issueRef: string): string | null {
    return this.cards.cardForIssue(projectId, issueRef);
  }

  /** Edits the title or the description. */
  updateCard(id: string, patch: Parameters<Cards["updateCard"]>[1]): Card {
    return this.cards.updateCard(id, patch);
  }

  /** Phase 31: the person dismisses the "unblocked" mark. */
  dismissUnblocked(id: string): Card {
    return this.blockers.dismissUnblocked(id);
  }

  /** The project with its five columns, each with its cards by position. */
  getBoard(projectId: string): BoardResult {
    const project = this.getProject(projectId);
    const cards = this.db
      .query<{ id: string }, [string]>(
        "SELECT id FROM cards WHERE project_id = ? AND arena_of IS NULL ORDER BY position, created_at",
      )
      .all(projectId)
      .map(({ id }) => this.getCard(id));
    const columns = BoardColumnSchema.options.map((column) => ({
      column,
      cards: cards.filter((card) => card.column === column),
    }));
    return { project, columns };
  }

  /**
   * Issue #1361: stores the card's check loop switch; the decision is `CheckLoopSwitch`'s
   * (board/check-loop.ts). A switch turned off forgets its confirmation.
   */
  storeCheckLoop(
    id: string,
    value: {
      on: boolean;
      rounds: number | null;
      confirmedAt: string | null;
      confirmedHash: string | null;
    },
  ): Card {
    return this.loopHost.store(id, value);
  }

  /** Issue #1361: the check loop's state machine; null when the host runs no check loop. */
  private get loop(): CheckLoopEngine | null {
    return this.loopHost.engine;
  }

  /** "Pedir ajuste": a message to the session of the active run. */
  message(id: string, text: string): { queued: boolean } {
    const { sessionId } = this.getCard(id);
    this.loop?.onPersonTurn(id);
    if (!sessionId)
      throw new FlightdeckError(
        "invalid_state",
        "the card has no session: start the card",
        "card_no_session",
      );
    return this.opts.manager.send(sessionId, text);
  }

  /**
   * Phase 13: told when a card's PR checks turn to failing (not on every poll that finds them
   * failing), with the names that failed; returns the function that stops it.
   */
  onChecksFailing(listener: (cardId: string, failed: string[]) => void): () => void {
    return this.prPoll.onChecksFailing(listener);
  }

  /**
   * Phase 22: a run with a prompt of its own (it waits in the same queue, quota and budgets as
   * any run), in a session nobody sits in; settled when its first turn ends.
   */
  fixCard(id: string, opts: { prompt: string; persona?: PersonaRef }): Promise<FixResult> {
    return this.sessions.fixCard(id, opts);
  }

  private settleFix(id: string, result: Partial<FixResult>): void {
    this.sessions.settleFix(id, result);
  }

  /** Gets every card after each change; returns the function that stops it. */
  watch(listener: (card: Card) => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  get watcherCount(): number {
    return this.watchers.size;
  }

  /** #1266: whether a failed run can resume from its failed step; with `confirm`, resumes it. */
  async resumeRun(runId: string, confirm: boolean): Promise<RunResumeCheck> {
    const run = this.workflows.getRun(runId);
    let project: Project;
    try {
      project = this.getProject(this.getCard(run.cardId).projectId);
    } catch {
      if (confirm) {
        throw new FlightdeckError("invalid_state", "the run's card is gone", "run_resume_card");
      }
      return { from: "", ok: false, reason: "run_resume_card" };
    }
    return confirm
      ? this.workflows.resume(runId, project)
      : this.workflows.resumeCheck(runId, project);
  }

  /**
   * Starts a new run of the card. It waits in the queue while every slot is taken; then the
   * worktree (created on the first run), the setup script and a fresh session.
   */
  startCard(id: string, options: Parameters<Cards["startCard"]>[1] = {}): Promise<Card> {
    return this.cards.startCard(id, options);
  }

  /** Another thing to wait for before a worktree is removed, besides `idle` (the run environment's trees). */
  addIdle(wait: () => Promise<unknown>): void {
    this.waits.push(wait);
  }

  /** Something that ends what runs in a card's worktree, asked before a discarded card's worktree goes. */
  addEnd(end: (cardId: string) => Promise<unknown>): void {
    this.ends.push(end);
  }

  /** Everything a worktree must wait for before it is removed. */
  private async settle(): Promise<void> {
    await this.opts.idle?.();
    await Promise.all(this.waits.map((wait) => wait()));
  }

  /** Looks up the key of every registered project, so what asks for it later finds it at hand. */
  async warmProjectKeys(): Promise<void> {
    const keys = this.opts.projectKeys;
    if (!keys?.resolve) return;
    const rows = this.db.query<{ path: string }, []>("SELECT path FROM projects").all();
    await Promise.all(rows.map((row) => keys.resolve?.(row.path)));
  }

  /** Starts queued runs, oldest first, while there are free slots. */
  private pump(): void {
    this.queue.pump();
  }

  /** Why a queued card waits, for the card itself: the pause, the quota, memory, a budget, then a slot. */
  /** Issue #1439: whether the project's budget holds new work now, for the card review's gate. */
  budgetHeld(projectId: string): boolean {
    return this.queue.budgetBlocked(projectId);
  }

  /** A `queue` budget of the host or of the card's project is at 100% (sync-git.test.ts reads it). */
  private budgetBlocked(projectId: string): boolean {
    return this.queue.budgetBlocked(projectId);
  }

  /** The card's run stopped holding a slot: the next one in the queue goes. */
  private release(cardId: string): void {
    this.queue.release(cardId);
  }

  /** A card's notice; one that came from a refusal keeps its reason, which the app translates. */
  private setNotice(id: string, notice: string, why?: unknown): void {
    this.db.query("UPDATE cards SET notice = ? WHERE id = ?").run(notice, id);
    this.setNoticeReason(id, why);
  }

  private setNoticeReason(id: string, why: unknown): void {
    const refusal = refusalOf(why);
    if (!refusal) return;
    this.db
      .query("UPDATE cards SET notice_reason = ?, notice_params = ? WHERE id = ?")
      .run(refusal.reason, JSON.stringify(refusal.params ?? {}), id);
  }

  /** Nothing reached the agent: the run ends and the card waits for the user with the error. */
  private failRun(id: string, runId: string, notice: string, why?: unknown): void {
    this.launcher.failRun(id, runId, notice, why);
  }

  private launch(id: string, runId: string): Promise<void> {
    return this.launcher.launch(id, runId);
  }

  /** Closes the card's sessions and ends its open runs, except `keep` (the one launching). */
  private closeRuns(id: string, keep = ""): Promise<void> {
    return this.launcher.closeRuns(id, keep);
  }

  /** The card is done: sessions closed, worktree removed unless something is still pending. */
  private finish(id: string): Promise<void> {
    return this.launcher.finish(id);
  }

  /** Moves the card by hand; Backlog and Concluído lock it there until the next start. */
  moveCard(id: string, column: BoardColumn, position?: number): Card {
    return this.lifecycle.moveCard(id, column, position);
  }

  /**
   * A person's move (the app's `card.move`): a column that confirms refuses a card that lacks what
   * its contract asks, unless `force`, which records what the card lacked (issue #78). Every other
   * caller of the board moves with `moveCard`, which asks nothing.
   */
  moveByHand(
    id: string,
    column: BoardColumn,
    position: number | undefined,
    force: boolean,
  ): Promise<Card> {
    return this.lifecycle.moveByHand(id, column, position, force);
  }

  /** A project's own template from its trusted checkout, or why it gives none (`CardLifecycle.templateFor`). */
  private templateFor(
    cwd: string,
    name: TemplateName,
    own?: true,
  ): Promise<{ body: string | null; ignored: TemplateIgnored | null }> {
    return this.lifecycle.templateFor(cwd, name, own);
  }

  /**
   * The project's own shape for a validation note (`.flightdeck/templates/validation.md`, trusted
   * projects only), given to the app as a placeholder and never saved; or why it was ignored
   * (issue #1058). Read from the trusted checkout; the card's worktree is only looked at by name
   * for an untrusted project, and a card with no worktree is asked for by its project's folder.
   */
  validationTemplate(
    id: string,
  ): Promise<{ text: string | null; ignored: TemplateIgnored | null }> {
    return this.lifecycle.validationTemplate(id);
  }

  /**
   * Looks at the card's spec file again (the path set on the card, else `docs/specs/<slug>.md`)
   * in its worktree, and keeps whether it is there and its first heading (issue #78).
   */
  refreshSpec(id: string): Promise<Card> {
    return this.lifecycle.refreshSpec(id);
  }

  /**
   * A queued card leaves the queue and goes back to the Backlog. A running one has its turn
   * interrupted, and the interrupted turn sends it to Esperando você.
   */
  stopCard(id: string): Promise<Card> {
    return this.lifecycle.stopCard(id);
  }

  /** Resolves when every rule accepted so far is in its file. */
  rulesWritten(): Promise<void> {
    return this.rules.written();
  }

  /** The project's rules: `permissions.allow` of its root `.claude/settings.local.json`. */
  listRules(projectId: string): Promise<string[]> {
    return this.rules.list(projectId);
  }

  /** Removes one rule of the project, keeping the rest of the file; only with `confirm`. */
  removeRule(projectId: string, rule: string, confirm: boolean): Promise<string[]> {
    return this.rules.remove(projectId, rule, confirm);
  }

  /** Workflows on the project's base branch, with validation and trust. */
  listWorkflows(projectId: string): Promise<WorkflowInfo[]> {
    return this.workflows.list(this.getProject(projectId));
  }

  /** One workflow of the project's base branch, with its validation. */
  validateWorkflow(projectId: string, name: string): Promise<WorkflowInfo> {
    return this.workflows.validate(this.getProject(projectId), name);
  }

  /** Trusts the workflow's current content (`hash`), which lets its `check` commands run. */
  trustWorkflow(projectId: string, name: string, hash: string): Promise<WorkflowInfo> {
    return this.workflows.trust(this.getProject(projectId), name, hash);
  }

  /** Issue #1221: one of `templates` on a new branch and a PR into the base, never on the base. */
  addWorkflowTemplate(
    projectId: string,
    templates: readonly WorkflowTemplate[],
    templateId: string,
    confirm: boolean,
  ): Promise<WorkflowTemplateAdded> {
    const project = this.getProject(projectId);
    const provider = (this.opts.prProvider ?? prProvider)(project.prProvider);
    return addWorkflowTemplate(project, templates, templateId, confirm, {
      provider,
      ...(this.opts.scanner ? { scanner: this.opts.scanner } : {}),
    });
  }

  /** Commits since the base plus uncommitted changes, per file. */
  diff(id: string): Promise<CardDiff> {
    return this.prFlow.diff(id);
  }

  /**
   * Pushes the card's branch to `origin` and opens the PR with the card's title and description;
   * `description` (phase 22) is the text the person confirmed, instead of the card's own.
   */
  createPr(id: string, options: { description?: string; title?: string } = {}): Promise<Card> {
    return this.prFlow.createPr(id, options);
  }

  /** #1196: merges the card's open PR on its provider, then reads it again so the card moves to Done. */
  mergePr(id: string, method: "merge" | "squash", confirm: boolean): Promise<Card> {
    return this.prFlow.mergePr(id, method, confirm);
  }

  /** The review comments of the card's PR, as last fetched (fetched now when there are none). */
  prComments(id: string): Promise<PrComment[]> {
    return this.prFlow.prComments(id);
  }

  /** Sends the chosen PR comments to the card's session, in the review's format. */
  sendPrComments(id: string, ids: readonly string[]): Promise<{ sent: number }> {
    return this.prFlow.sendPrComments(id, ids);
  }

  /** Rebases the card's branch on its base; a conflict aborts and leaves the worktree as it was. */
  updateFromBase(id: string): Promise<Card> {
    return this.prFlow.updateFromBase(id);
  }

  /**
   * "Merge e arquivar" for a card without a PR: into the base where it is checked out (clean), or
   * through a temporary worktree; then the card's worktree and branch go and it is Concluído.
   */
  mergeLocal(
    id: string,
    mode: "merge" | "squash",
    confirm: boolean,
    /** Phase 40: the message the person confirmed, else the default of the mode. */
    message?: string,
  ): Promise<Card> {
    return this.prFlow.mergeLocal(id, mode, confirm, message);
  }

  /** Manual completion: Concluído (locked) and the same cleanup as a merged PR. */
  completeCard(id: string, confirm: boolean): Promise<Card> {
    return this.lifecycle.completeCard(id, confirm);
  }

  /**
   * Throws the card away: sessions closed, worktree removed even with changes, local branch
   * deleted, card off the board. Returns its last state, marked `discarded`.
   */
  discardCard(id: string, confirm: boolean): Promise<Card> {
    return this.lifecycle.discardCard(id, confirm);
  }

  /**
   * Deletes a card that never started (no worktree, no branch, no session, no run). Returns its
   * last state, marked `discarded` like a discarded card, so the app drops it the same way.
   * A card that started has work to clean up and goes through `discardCard`.
   */
  deleteCard(id: string, confirm: boolean): Card {
    return this.lifecycle.deleteCard(id, confirm);
  }

  /** Calls `listener` after every round of the PR polling. */
  onPrRound(listener: () => void): () => void {
    return this.prPoll.onPrRound(listener);
  }

  get prPollIntervalMs(): number {
    return this.prPoll.intervalMs;
  }

  /** Asks the provider about every card with an open PR; one round at a time. */
  pollPrs(): Promise<void> {
    return this.prPoll.pollPrs();
  }

  get maxParallelRuns(): number {
    return this.queue.maxParallelRuns;
  }

  /** A higher limit starts queued cards right away; a lower one lets running ones finish. */
  async setMaxParallelRuns(value: number): Promise<void> {
    this.queue.setLimit(value);
    await this.opts.onSettingsChange?.({ maxParallelRuns: value });
  }

  /** Resolves when no PR poll round is running (stop() lets the one in flight finish). */
  idle(): Promise<void> {
    return this.prPoll.idle();
  }

  stop(): void {
    this.stopped = true;
    this.loop?.dispose();
    this.prPoll.dispose();
    this.queue.dispose();
    this.sessions.unfollowAll();
  }

  // -- internals ------------------------------------------------------------

  private place(id: string, event: BoardEvent, via?: DoneVia): void {
    const card = this.getCard(id);
    const next = nextColumn({ column: card.column, locked: card.columnLocked }, event);
    this.db
      .query("UPDATE cards SET board_column = ?, column_locked = ?, updated_at = ? WHERE id = ?")
      .run(next.column, next.locked ? 1 : 0, now(), id);
    // The first time a card is done is the fact the ROI view counts delivered work by.
    if (next.column === "done" && card.column !== "done") {
      const how = via ?? (event.type === "pr" && event.state === "merged" ? "merged" : "moved");
      recordDone(this.db, id, how, now());
    }
    this.changed(id);
  }

  /** Whether a card's run uses this session: the board follows it, so the host never puts it to sleep. */
  hasRunSession(sessionId: string): boolean {
    return (
      this.db
        .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM card_runs WHERE session_id = ?")
        .get(sessionId)?.n !== 0
    );
  }

  /** Every card of the project that has a worktree, arena variants included. */
  worktreeCards(projectId: string): Card[] {
    return this.db
      .query<{ id: string }, [string]>(
        "SELECT id FROM cards WHERE project_id = ? AND worktree_path IS NOT NULL",
      )
      .all(projectId)
      .map(({ id }) => this.getCard(id));
  }

  /** Whether a card's run is going or waiting: its folder is in use. */
  isActive(cardId: string): boolean {
    return this.queue.has(cardId) || this.getCard(cardId).queued;
  }

  /** Issue #1405: reads what the card changed and tells the cards that now share files with it. */
  refreshConflicts(id: string): Promise<void> {
    return this.radarFeed.refresh(id);
  }

  /** The card no longer takes part in the radar; the cards that were flagged with it hear of it. */
  private dropConflicts(id: string): void {
    this.radarFeed.drop(id);
  }

  /** The card no longer has its worktree (a panel removed it); the watchers hear of it. */
  releaseWorktree(id: string, path: string, clearBranch: boolean): void {
    // Only the worktree that was removed: a card that got another one meanwhile keeps it.
    const done = this.db
      .query(
        `UPDATE cards SET worktree_path = NULL, notice = NULL, updated_at = ?${
          clearBranch ? ", branch = NULL" : ""
        } WHERE id = ? AND worktree_path = ?`,
      )
      .run(new Date().toISOString(), id, path);
    if (done.changes === 0) return;
    this.dropConflicts(id);
    this.changed(id);
  }

  /** Tells the watchers about a card whose fields changed outside the board (the board sync's). */
  announce(id: string): void {
    this.changed(id);
  }

  /** Sends the card as it is now to every watcher, and returns it. */
  private changed(id: string): Card {
    const card = this.getCard(id);
    this.emit(card);
    // What a card waits for follows its blockers' columns: the cards it holds up are news too.
    for (const dependent of this.blockers.blockingOf(id)) {
      this.blockers.afterBlockerChange(dependent);
      this.emit(this.getCard(dependent));
    }
    return card;
  }

  private emit(card: Card): void {
    // A variant is not on the board: what changed in it is news of the arena's card.
    const shown = card.arenaOf ? this.getCard(card.arenaOf) : card;
    for (const watcher of this.watchers) {
      try {
        watcher(shown);
      } catch {
        // A broken watcher must not break the board.
      }
    }
  }

  /** Session events of the card's active run move the card (replay first, then live). */
  private follow(cardId: string, sessionId: string, sinceSeq: number): void {
    this.sessions.follow(cardId, sessionId, sinceSeq);
  }

  /** A test drives a session event by hand (check-loop-board.test.ts): kept as a delegate. */
  private onSessionEvent(
    cardId: string,
    event: SessionEvent,
    at: { live: boolean; seq: number },
  ): void {
    this.sessions.onSessionEvent(cardId, event, at);
  }

  /** Issue #1361: the person wrote into a card's session, or answered it: the loop steps aside. */
  personTurnOfSession(sessionId: string): void {
    this.sessions.personTurnOfSession(sessionId);
  }
}
