import type { Database } from "bun:sqlite";
import {
  type CardTemplates,
  type EffortLevel,
  type PermissionMode,
  type PersonaRef,
  PINNED_DOCS_MAX,
  pinnedDocProblem,
  specPathProblem,
  type UnblockWhen,
} from "@flightdeck/protocol";
import { FlightdeckError, ulid } from "../kernel/index.ts";
import { CARDS_PER_RUN, type CardsRaised, type Finding } from "../workflows/index.ts";
import { CardRows } from "./adapters/card-rows.ts";
import { parseCardTemplates } from "./domain/card-templates.ts";
import type { BoardEvent } from "./domain/columns.ts";
import type { TemplateIgnored, TemplateName } from "./spec-template.ts";
import type { BoardColumn, BoardOptions, Card, Project } from "./types.ts";

/** Issue #79: a card done this recently still covers the key of the finding it was raised from. */
const DONE_COVERS_MS = 30 * 24 * 60 * 60 * 1000;
/** Two titles are the same when only their case and spacing differ. */
const sameTitle = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase();
const raisedBy = (origin: { workflow: string; runId: string }) =>
  `Raised by the workflow ${origin.workflow} (run ${origin.runId}) from what its agent found in the repository. The text below is the agent's and has not been reviewed.`;

/** A spec path a card is given must be a relative Markdown path inside the worktree. */
function judgeSpecPath(path: string | null | undefined): void {
  if (typeof path === "string" && specPathProblem(path) !== null) {
    throw new FlightdeckError(
      "bad_request",
      "the spec path must be a relative path to a Markdown file inside the worktree",
      "spec_path_invalid",
    );
  }
}

/** Pinned documents a card is given: Markdown files in the library's folders, at most 10. */
function judgePins(pins: string[]): void {
  if (pins.length > PINNED_DOCS_MAX || pins.some((doc) => pinnedDocProblem(doc) !== null)) {
    throw new FlightdeckError(
      "bad_request",
      "a pinned document must be a Markdown file in the project's docs folders, and a card pins at most 10",
      "pinned_doc_invalid",
    );
  }
}

/** The auto-start as the cards table keeps it. */
const autoStartOf = (autoStart: { workflow: string | null } | null | undefined) =>
  autoStart ? JSON.stringify(autoStart) : null;

const now = () => new Date().toISOString();

/** What making and starting cards needs of the board (issue #1523); late-bound, so it never imports `board.ts`. */
export interface CardsPort {
  db: Database;
  opts: Pick<BoardOptions, "clock" | "suspendApproval">;
  /** The workflow engine, as far as starting a card reads it. */
  workflows: {
    active: (runId: string) => boolean;
    prepare: (
      cardId: string,
      runId: string,
      project: Project,
      workflow: string,
      inputs: Record<string, string>,
    ) => Promise<unknown>;
  };
  card: (id: string) => Card;
  project: (id: string) => Project;
  changed: (id: string) => Card;
  place: (id: string, event: BoardEvent) => void;
  /** The run queue: whether a card holds a slot, and moving the queue on. */
  queued: (id: string) => boolean;
  pump: () => void;
  templateFor: (
    cwd: string,
    name: TemplateName,
    own?: true,
  ) => Promise<{ body: string | null; ignored: TemplateIgnored | null }>;
  removeFromBoard: (id: string, verb: "discarded" | "deleted") => Card;
  /** The mark that tells agent or third-party text apart (`issues/issues.ts`): raised cards start with it. */
  untrustedMark: string;
  blockers: {
    checkBlockers: (id: string | null, projectId: string, blockers: readonly string[]) => void;
    storeBlockers: (id: string, blockers: readonly string[]) => void;
    noteWaiting: (id: string) => void;
    refuseIfBlocked: (card: Card) => void;
  };
}

/**
 * Issue #1523: making cards (by hand, from a project's template, from a workflow's findings),
 * editing them, finding the card of an issue, and starting a card's run through its gates.
 */
export class Cards {
  private readonly rows: CardRows;

  constructor(private readonly port: CardsPort) {
    this.rows = new CardRows(port.db);
  }

  /**
   * Issue #79: raises the findings of a workflow's agent step as Backlog cards, skipping those a
   * card of the project already covers (by key, or by title among the open ones) and creating at
   * most `CARDS_PER_RUN`. The text is the agent's: marked as such, with approval kept off.
   */
  raiseCards(
    projectId: string,
    findings: readonly Finding[],
    origin: { workflow: string; runId: string },
  ): CardsRaised {
    this.port.project(projectId);
    const at = (this.port.opts.clock ?? Date.now)();
    // A key is covered by any card that has it, except one done longer ago than the window.
    const covered = new Set<string>();
    for (const row of this.rows.sourceKeys(projectId)) {
      if (row.board_column !== "done" || at - Date.parse(row.updated_at) < DONE_COVERS_MS) {
        covered.add(row.source_key);
      }
    }
    const titles = new Set(this.rows.openTitles(projectId).map(sameTitle));
    const raised: CardsRaised = { created: [], duplicates: 0, overCap: 0 };
    for (const finding of findings) {
      if (covered.has(finding.key) || titles.has(sameTitle(finding.title))) {
        raised.duplicates++;
      } else if (raised.created.length >= CARDS_PER_RUN) {
        raised.overCap++;
      } else {
        const card = this.createCard(projectId, {
          title: finding.title,
          description: [this.port.untrustedMark, raisedBy(origin), finding.body]
            .filter((part) => part !== "")
            .join("\n\n"),
          issueExternal: true,
          sourceKey: finding.key,
        });
        covered.add(finding.key);
        titles.add(sameTitle(finding.title));
        try {
          this.port.opts.suspendApproval?.(card.id, "card raised from an agent's findings");
        } catch (error) {
          // A card without its suspension must not stay: the ones before it have theirs.
          this.port.removeFromBoard(card.id, "discarded");
          throw error;
        }
        raised.created.push(card.id);
      }
    }
    return raised;
  }

  /**
   * Issue #1201: the project's card templates (`.flightdeck/templates/cards.json`, trusted projects
   * only, read from the trusted checkout): the ones offered, how many entries were left out, and
   * why a file that is there was not used.
   */
  async cardTemplates(projectId: string): Promise<CardTemplates> {
    const project = this.port.project(projectId);
    const found = await this.port.templateFor(project.path, "cards", true);
    if (found.ignored !== null) return { templates: [], dropped: 0, ignored: found.ignored };
    if (found.body === null) return { templates: [], dropped: 0, ignored: null };
    const { templates, dropped, invalid } = parseCardTemplates(found.body);
    return { templates, dropped, ignored: invalid ? "invalid" : null };
  }

  /**
   * A new card, filled from one of the project's templates when `templateId` names one: its
   * workflow, persona, pins and spec file, and its text when the person typed none. A template the
   * project does not offer (or does not trust) refuses the card.
   */
  async createCardFrom(
    projectId: string,
    input: Parameters<Cards["createCard"]>[1] & { templateId?: string },
  ): Promise<Card> {
    const { templateId, ...rest } = input;
    if (templateId === undefined) return this.createCard(projectId, rest);
    const template = (await this.cardTemplates(projectId)).templates.find(
      (candidate) => candidate.id === templateId,
    );
    if (!template) {
      throw new FlightdeckError(
        "bad_request",
        `the project offers no card template ${templateId}`,
        "card_template_unknown",
      );
    }
    return this.createCard(projectId, {
      ...rest,
      description: rest.description.trim() ? rest.description : template.description,
      specPath: template.spec,
      pinnedDocs: template.pins,
      startWorkflow: template.workflow,
      startPersona: template.persona,
    });
  }

  /** A new card goes to the end of the column it is born in: the Backlog unless it says another. */
  createCard(
    projectId: string,
    input: {
      title: string;
      description: string;
      /** The column the card is born in; the Backlog when absent. */
      column?: BoardColumn;
      issueRef?: string;
      issueExternal?: boolean;
      /** Issue #79: the key of the finding it was raised from. */
      sourceKey?: string;
      /** Phase 31: what the card waits for. */
      blockedBy?: string[];
      unblockWhen?: UnblockWhen;
      autoStart?: { workflow: string | null } | null;
      /** Issue #1201: what a card template fills in; the spec path and the pins are judged as an edit's are. */
      specPath?: string | null;
      pinnedDocs?: string[];
      startWorkflow?: string | null;
      startPersona?: string | null;
      /** An arena variant: the arena's card, and what makes it different. */
      arenaOf?: string;
      variant?: {
        label: string;
        model: string | null;
        effort: EffortLevel | null;
        /** Phase 20: the id of the persona the variant runs in. */
        persona?: string | null;
        /** Issue #93: the permission mode the variant's session opens in. */
        permissionMode?: PermissionMode | null;
      };
    },
  ): Card {
    this.port.project(projectId);
    judgeSpecPath(input.specPath);
    const pins = [...new Set(input.pinnedDocs ?? [])];
    judgePins(pins);
    const blockedBy = input.blockedBy ?? [];
    this.port.blockers.checkBlockers(null, projectId, blockedBy);
    const column = input.column ?? "backlog";
    const last = this.rows.lastPosition(projectId, column);
    const id = ulid();
    this.rows.insert({
      id,
      projectId,
      title: input.title,
      description: input.description,
      column,
      position: (last ?? 0) + 1,
      issueRef: input.issueRef ?? null,
      issueExternal: input.issueExternal ?? false,
      arenaOf: input.arenaOf ?? null,
      variant: input.variant ? JSON.stringify(input.variant) : null,
      unblockWhen: input.unblockWhen ?? "done",
      autoStart: autoStartOf(input.autoStart),
      at: now(),
      sourceKey: input.sourceKey ?? null,
      specPath: input.specPath ?? null,
      pinnedDocs: pins.length > 0 ? JSON.stringify(pins) : null,
      startWorkflow: input.startWorkflow ?? null,
      startPersona: input.startPersona ?? null,
    });
    this.port.blockers.storeBlockers(id, blockedBy);
    this.port.blockers.noteWaiting(id);
    for (const blocker of blockedBy) this.port.changed(blocker);
    return this.port.changed(id);
  }

  /** The card already made from an issue of the project, if any. */
  cardForIssue(projectId: string, issueRef: string): string | null {
    return this.rows.idForIssue(projectId, issueRef);
  }

  /** Edits the title or the description. */
  updateCard(
    id: string,
    patch: {
      title?: string;
      description?: string;
      /** Phase 36: `null` removes the estimate. */
      estimateHours?: number | null;
      /** Issue #78: blank or `null` clears the note. */
      validationNote?: string | null;
      /** Issue #78: the spec file in the worktree; `null` goes back to the default. */
      specPath?: string | null;
      /** Issue #76: the library documents pinned to the card; replaces the whole list. */
      pinnedDocs?: string[];
      blockedBy?: string[];
      unblockWhen?: UnblockWhen;
      autoStart?: { workflow: string | null } | null;
    },
  ): Card {
    const card = this.port.card(id);
    if (patch.blockedBy) this.port.blockers.checkBlockers(id, card.projectId, patch.blockedBy);
    const specPath = patch.specPath === undefined ? card.specPath : patch.specPath;
    // Only a path that comes in the patch is judged: one stored earlier does not block an edit.
    judgeSpecPath(patch.specPath);
    const pinned =
      patch.pinnedDocs === undefined ? card.pinnedDocs : [...new Set(patch.pinnedDocs)];
    // Only pins that come in the patch are judged: ones stored earlier do not block an edit.
    if (patch.pinnedDocs !== undefined) judgePins(pinned);
    this.rows.edit(id, {
      title: patch.title ?? card.title,
      description: patch.description ?? card.description,
      estimateHours: patch.estimateHours === undefined ? card.estimateHours : patch.estimateHours,
      validationNote:
        patch.validationNote === undefined
          ? card.validationNote
          : patch.validationNote?.trim() || null,
      specPath,
      pinnedDocs: pinned.length === 0 ? null : JSON.stringify(pinned),
      unblockWhen: patch.unblockWhen ?? card.unblockWhen,
      autoStart: autoStartOf(patch.autoStart === undefined ? card.autoStart : patch.autoStart),
      at: now(),
    });
    // What was found belongs to the path it was found at.
    if (specPath !== card.specPath) this.rows.forgetSpecFound(id);
    if (patch.blockedBy) {
      const changed = new Set([...card.blockedBy, ...patch.blockedBy]);
      this.port.blockers.storeBlockers(id, patch.blockedBy);
      this.port.blockers.noteWaiting(id);
      for (const blocker of changed) this.port.changed(blocker);
    }
    return this.port.changed(id);
  }

  /**
   * Starts a new run of the card. It waits in the queue while every slot is taken; then the
   * worktree (created on the first run), the setup script and a fresh session.
   */
  async startCard(
    id: string,
    options: {
      workflow?: string;
      inputs?: Record<string, string>;
      /** The persona to open the session in; else the default of the card's column. */
      persona?: PersonaRef;
      /** Phase 22 (`fixCard`): the run's prompt, instead of the card's description. */
      fix?: { prompt: string };
    } = {},
  ): Promise<Card> {
    const card = this.port.card(id);
    // A fix run answers a PR that exists already: it is never held back by the card's blockers.
    if (!options.fix) this.port.blockers.refuseIfBlocked(card);
    if (card.queued || this.port.queued(id)) {
      throw new FlightdeckError(
        "invalid_state",
        `card ${id} is already queued or running`,
        "card_queued",
        { id },
      );
    }
    if (card.workflowRunId && this.port.workflows.active(card.workflowRunId)) {
      throw new FlightdeckError(
        "invalid_state",
        "the card has a workflow run in progress",
        "card_workflow_running",
      );
    }
    const runId = ulid();
    if (options.workflow) {
      const project = this.port.project(card.projectId);
      await this.port.workflows.prepare(id, runId, project, options.workflow, options.inputs ?? {});
    }
    // Asked for in the start, else the default of the column the card is in; kept with the run
    // because the session only opens when the run leaves the queue.
    const standard = this.port.project(card.projectId).personaByColumn[card.column];
    const persona = options.persona ?? (standard ? { id: standard } : null);
    this.rows.insertRun({
      id: runId,
      cardId: id,
      at: now(),
      persona: persona ? JSON.stringify(persona) : null,
      fixPrompt: options.fix?.prompt ?? null,
    });
    this.rows.resetForRun(id);
    this.port.place(id, { type: "started" });
    this.port.pump();
    return this.port.changed(id);
  }
}
