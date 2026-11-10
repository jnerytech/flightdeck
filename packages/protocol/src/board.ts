// The Board context's cards: their PR state and checks loop, blockers, arenas, worktrees, reviews and the issues they come from (issue #1600: moved from index.ts).
import { z } from "zod";
import {
  BoardColumn,
  type CardTemplates,
  ChecksState,
  PINNED_DOCS_MAX,
  pinnedDocProblem,
  SPEC_PATH_MAX,
  SpecState,
  specPathProblem,
  type ValidationTemplate,
} from "./board-contracts.ts";
import { SessionIdentity } from "./collaboration.ts";
import { cmd } from "./command.ts";
import { PermissionMode } from "./permissions.ts";
import { PersonaRef } from "./personas.ts";
import { DiffFile, ReviewFinding } from "./review.ts";
import { EffortLevel, type SessionSendResult, SessionStatus } from "./sessions.ts";

// Phase 4: projects (git repositories of the host) and their boards of cards.
export const PrProviderKind = z.enum(["github", "azure-devops", "none"]);
export type PrProviderKind = z.infer<typeof PrProviderKind>;

export const PrState = z.enum(["open", "merged", "closed"]);
export type PrState = z.infer<typeof PrState>;

/** Issue #1352: whether a PR can be merged as it is, as its host reports it. */
export const PrMergeable = z.enum(["clean", "conflict", "blocked", "unknown"]);
export type PrMergeable = z.infer<typeof PrMergeable>;

/** Issue #1352: where the PR stands with its reviewers. */
export const PrReview = z.enum(["approved", "changes_requested", "required", "none"]);
export type PrReview = z.infer<typeof PrReview>;

/** Issue #1405: another card of the project that changes some of the same files. */
export const MayConflict = z.object({
  cardId: z.string(),
  title: z.string(),
  /** The files both cards change (capped by the daemon). */
  files: z.array(z.string()),
});
export type MayConflict = z.infer<typeof MayConflict>;

/** Phase 13: where a project's issues come from, and whether a PR comments on its issue. */
export const IssuesConfig = z.object({
  provider: z.enum(["github", "azure"]),
  /** GitHub search or Azure WIQL; the default is "assigned to me, open". */
  query: z.string().min(1).optional(),
  /** Off by default: a comment on the issue is a write to the provider. */
  commentOnPr: z.boolean().default(false),
});
export type IssuesConfig = z.infer<typeof IssuesConfig>;

/** Phase 13: an issue (GitHub) or work item (Azure Boards). */
export const Issue = z.object({
  /** `github:owner/repo#n` or `azure:org/project#id`. */
  ref: z.string(),
  id: z.string(),
  title: z.string(),
  body: z.string(),
  url: z.string(),
  author: z.string(),
  labels: z.array(z.string()),
  /** Not you, nor (GitHub) an owner, member or collaborator: third-party content. */
  external: z.boolean(),
  createdAt: z.string(),
});
export type Issue = z.infer<typeof Issue>;

export const CardRun = z.object({
  /** `null` while queued or preparing the worktree. */
  sessionId: z.string().nullable(),
  queuedAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});
export type CardRun = z.infer<typeof CardRun>;

/** Phase 31: what satisfies a blocker. */
export const UnblockWhen = z.enum(["done", "merged"]);
export type UnblockWhen = z.infer<typeof UnblockWhen>;

/** Phase 31: the fields of a card that say what it waits for. */
const CardDeps = {
  blockedBy: z
    .array(z.string())
    .refine((ids) => new Set(ids).size === ids.length)
    .optional(),
  unblockWhen: UnblockWhen.optional(),
  autoStart: z.object({ workflow: z.string().nullable() }).nullable().optional(),
};

/** Issue #1361: why a card's check loop ended; the app names each in its language. */
export const CheckLoopReason = z.enum([
  "passed",
  "rounds_spent",
  "budget",
  "quota",
  "memory",
  "person_turn",
  "stopped_by_you",
  "session_ended",
  "no_result",
  "check_loop_confirm",
  "check_loop_untrusted",
  "check_loop_mode",
  "check_refused",
  "check_error",
  "turn_error",
  "interrupted",
]);
export type CheckLoopReason = z.infer<typeof CheckLoopReason>;

/** Issue #1361: the last line of a card's loop: a round sent, or how the loop ended. */
export const CheckLoopLine = z.object({
  state: z.enum(["sent", "ended"]),
  /** On an end; a reason a newer app does not know reads as `null`. */
  reason: CheckLoopReason.nullable().catch(null),
  /** The failed check's command, masked; `null` when no check failed. */
  command: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  at: z.string(),
});
export type CheckLoopLine = z.infer<typeof CheckLoopLine>;

/** Issue #1361: a card's switch for "keep going until the checks pass", and how its loop goes. */
export const CheckLoopSwitch = z.object({
  on: z.boolean(),
  /** The card's own cap on rounds, below the project's; `null` takes the project's. */
  rounds: z.number().int().min(1).max(10).nullable(),
  /** The person confirmed that the checks run the card's code outside its permission mode. */
  confirmed: z.boolean(),
  /** What the loop does now: its checks run, or a round it sent is being worked on. */
  active: z.enum(["checking", "fixing"]).nullable().optional(),
  /** Rounds sent in the loop going on, and the most it may send. */
  round: z.number().int().min(0).optional(),
  max: z.number().int().min(1).optional(),
  last: CheckLoopLine.nullable().optional(),
});
export type CheckLoopSwitch = z.infer<typeof CheckLoopSwitch>;

export const Card = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string(),
  column: BoardColumn,
  /** Moved by hand to Backlog or Concluído: events leave it there until the next start. */
  columnLocked: z.boolean(),
  position: z.number(),
  slug: z.string().nullable(),
  branch: z.string().nullable(),
  worktreePath: z.string().nullable(),
  prUrl: z.string().nullable(),
  prState: PrState.nullable(),
  checksState: ChecksState.nullable(),
  /** Issue #1352 (host `prDetails`): merge state, review state and open date, read with the checks. */
  prMergeable: PrMergeable.nullable().optional(),
  prReview: PrReview.nullable().optional(),
  prOpenedAt: z.string().nullable().optional(),
  /** Issue #1405 (host `conflictRadar`): the cards that edit the same files; absent when none. */
  mayConflict: z.array(MayConflict).optional(),
  /** Started and waiting for a free slot. */
  queued: z.boolean(),
  /** Session of the active (latest) run. */
  sessionId: z.string().nullable(),
  sessionStatus: SessionStatus.nullable(),
  /** Last problem worth showing on the card (failed setup, worktree kept on completion). */
  notice: z.string().nullable(),
  /** Why, when the notice came from a refusal: the app translates it, the notice is the fallback. */
  noticeReason: z.string().nullable().optional(),
  noticeParams: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .nullable()
    .optional(),
  /** Set only on the last update of a discarded card, which leaves the board. */
  discarded: z.boolean(),
  runs: z.array(CardRun),
  /** Workflow run of the active run; `null` for a simple card (phase 4). */
  workflowRunId: z.string().nullable().default(null),
  /** Why a queued card waits: a free slot, or the host's plan quota (phase 7). */
  queueReason: z.enum(["slot", "quota", "memory", "budget", "paused"]).nullable().default(null),
  /** With `queueReason: quota`, when the window resets (ISO); `null` when unknown. */
  quotaUntil: z.string().nullable().default(null),
  /** Phase 13: an arena variant's parent card; variants are not on the board. */
  arenaOf: z.string().nullable().default(null),
  /** Phase 13: what makes an arena variant different from its siblings. */
  variant: z
    .object({
      label: z.string(),
      model: z.string().nullable(),
      effort: EffortLevel.nullable(),
      /** Phase 20: the id of the persona the variant runs in. */
      persona: z.string().nullable().optional(),
      /** Issue #93: the permission mode the variant's session opens in (a team's worker). */
      permissionMode: PermissionMode.nullable().optional(),
    })
    .nullable()
    .default(null),
  /** Phase 13: how many arena variants the card has (0 when it is not in an arena). */
  arenaVariants: z.number().int().nonnegative().default(0),
  /** Phase 13: the issue this card came from (`github:owner/repo#n`, `azure:org/project#id`). */
  issueRef: z.string().nullable().default(null),
  /** Phase 13: the issue's author is third party, so the card's content is untrusted. */
  issueExternal: z.boolean().default(false),
  /** Phase 38: the item of an external board this card follows, and whether it has left that board. */
  externalUrl: z.string().nullable().default(null),
  externalGone: z.boolean().default(false),
  /** Phase 36: the hours this card is worth, an estimate the person typed. */
  estimateHours: z.number().nullable().default(null),
  /** Issue #78: what the person did to validate the work, a note a column can ask for. */
  validationNote: z.string().nullable().default(null),
  /** Issue #1361: the check loop's switch; absent from older daemons. */
  checkLoop: CheckLoopSwitch.optional(),
  /** Issue #78: the spec file the card names in its worktree; `null` is `docs/specs/<slug>.md`. */
  specPath: z.string().nullable().default(null),
  /** Issue #78: what the host last found of the spec file; `null` until it looked. */
  specState: SpecState.nullable().default(null),
  /** Issue #76: the library documents the person pinned to this card, relative paths in order. */
  pinnedDocs: z.array(z.string()).default([]),
  /** Issue #1201: the workflow and the persona the card is meant to start with (a template's); `null`: the default. */
  startWorkflow: z.string().nullable().default(null),
  startPersona: z.string().nullable().default(null),
  /** Phase 31: the cards that must be done first, in the order the person set them. */
  blockedBy: z.array(z.string()).default([]),
  /** Phase 31: the cards this one holds up (the other end of `blockedBy`, never stored twice). */
  blocking: z.array(z.string()).default([]),
  /** Phase 31: the blockers not satisfied yet; empty once the card has started. */
  waitingOn: z.array(z.string()).default([]),
  /** Phase 31: what satisfies a blocker: its card in Done, or its PR merged. */
  unblockWhen: UnblockWhen.default("done"),
  /** Phase 31: start by itself when the last blocker is satisfied (with this workflow, if any). */
  autoStart: z.object({ workflow: z.string().nullable() }).nullable().default(null),
  /** Phase 31: when the last blocker was satisfied and the card did not start by itself. */
  unblockedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Card = z.infer<typeof Card>;

/** Phase 13: one variant of an arena, as the comparison shows it. */
export const ArenaVariant = z.object({
  /** The variant's own card id; `card.chooseVariant` takes it. */
  id: z.string(),
  label: z.string(),
  model: z.string().nullable(),
  effort: EffortLevel.nullable(),
  /** Phase 20: the id of the persona the variant runs in; `null` for none. */
  persona: z.string().nullable(),
  branch: z.string().nullable(),
  worktreePath: z.string().nullable(),
  /** Started and waiting for a free slot. */
  queued: z.boolean(),
  sessionStatus: SessionStatus.nullable(),
  column: BoardColumn,
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  /** The estimated cost of its sessions; `null` when the host does not price them. */
  costUsd: z.number().nonnegative().nullable(),
  files: z.array(
    z.object({
      path: z.string(),
      additions: z.number().int().nonnegative(),
      deletions: z.number().int().nonnegative(),
    }),
  ),
  /** The `check` steps of its workflow run, if it ran one. */
  checks: z.array(z.object({ stepId: z.string(), status: z.string() })),
  notice: z.string().nullable(),
});
export type ArenaVariant = z.infer<typeof ArenaVariant>;

export const Arena = z.object({ cardId: z.string(), variants: z.array(ArenaVariant) });
export type Arena = z.infer<typeof Arena>;

export const CardDiff = z.object({ base: z.string(), files: z.array(DiffFile) });
export type CardDiff = z.infer<typeof CardDiff>;

/** Issue #1439: a card's review: its findings are reviewer drafts; `loose` anchored nowhere. */
export const CardReviewResult = z.object({
  state: z.enum(["done", "failed"]),
  summary: z.string(),
  anchored: z.number().int().nonnegative(),
  loose: z.array(ReviewFinding),
  cached: z.boolean(),
  moved: z.boolean(),
});
export type CardReviewResult = z.infer<typeof CardReviewResult>;

/** A review comment of a card's PR, read from GitHub or Azure DevOps; nothing is posted back. */
export const PrComment = z.object({
  id: z.string(),
  /** `null` for a review's summary, about the whole PR. */
  path: z.string().nullable(),
  line: z.number().int().nullable(),
  author: z.string(),
  /**
   * GitHub's `author_association` (OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE…), as the API
   * says it; `null` on Azure DevOps. The automations ignore comments from outside the team.
   */
  authorAssociation: z.string().nullable().default(null),
  /** Azure DevOps' identity of the author (`uniqueName`, else the id); `null` on GitHub. */
  authorIdentity: z.string().nullable().default(null),
  body: z.string(),
  resolved: z.boolean(),
  kind: z.enum(["inline", "review"]),
});
export type PrComment = z.infer<typeof PrComment>;

export const CardIdPayload = z.object({ cardId: z.string() });

/** Phase 6: with `workflow`, the card runs that trusted workflow with `inputs`. */
export const CardStartPayload = z.object({
  cardId: z.string(),
  workflow: z.string().min(1).optional(),
  inputs: z.record(z.string(), z.string()).optional(),
  /** Opens the card's session in that persona, over the column's default (phase 20). */
  persona: PersonaRef.optional(),
});

/** Completion and discard only happen with `confirm: true`; the daemon refuses anything else. */
export const CardConfirmPayload = z.object({ cardId: z.string(), confirm: z.boolean().optional() });

/** Issue #152: why a worktree is kept and not offered for removal. */
export const WorktreeBlocker = z.enum([
  "live_session",
  "running",
  "dirty",
  "unpushed",
  "unknown_base",
  /** git could not say (a command failed or answered nonsense): nothing is removed. */
  "unknown_state",
  /** The worktree is on a branch that is not one of Flightdeck's `fd/*`. */
  "other_branch",
  /** It holds files git ignores that are not rebuildable (not `node_modules`, build output…). */
  "ignored_files",
  /** A tracked file is hidden from `git status` (`assume-unchanged`, `skip-worktree`): its edits would go. */
  "hidden_changes",
]);
export type WorktreeBlocker = z.infer<typeof WorktreeBlocker>;

export const WorktreeItem = z.object({
  projectId: z.string(),
  projectName: z.string(),
  path: z.string(),
  branch: z.string().nullable(),
  cardId: z.string().nullable(),
  cardTitle: z.string().nullable(),
  column: BoardColumn.nullable(),
  prState: PrState.nullable(),
  dirty: z.boolean(),
  /** Commits that exist nowhere else: not on a remote and not on the base branch. */
  unpushed: z.number().int().nonnegative(),
  /** Bytes on disk; null when the scan was not finished in time (never shown as 0). */
  sizeBytes: z.number().nonnegative().nullable(),
  /** The newest of the last commit, the card's last change and the folder's. */
  lastActivity: z.string(),
  idleDays: z.number().nonnegative(),
  blockers: z.array(WorktreeBlocker),
  /** Safe to remove and worth it: no blocker, finished or without a card, idle over 7 days. */
  suggested: z.boolean(),
});
export type WorktreeItem = z.infer<typeof WorktreeItem>;

export const WorktreesResult = z.object({
  worktrees: z.array(WorktreeItem),
  disks: z.array(
    z.object({
      projectId: z.string(),
      totalBytes: z.number().nonnegative(),
      freeBytes: z.number().nonnegative(),
    }),
  ),
});
export type WorktreesResult = z.infer<typeof WorktreesResult>;

export const WorktreeRemoveResult = z.object({
  removed: z.array(
    z.object({
      path: z.string(),
      freedBytes: z.number().nonnegative().nullable(),
      /** The folder went but its branch was kept: it had moved, or git refused to delete it. */
      branchKept: z.boolean().optional(),
    }),
  ),
  kept: z.array(
    z.object({
      path: z.string(),
      reason: z.union([WorktreeBlocker, z.enum(["not_listed", "failed"])]),
      detail: z.string().optional(),
    }),
  ),
});
export type WorktreeRemoveResult = z.infer<typeof WorktreeRemoveResult>;

/** Sent after `board.watch` with the whole card after each change. Not a session event. */
export const CardUpdated = z.object({ type: z.literal("card.updated"), card: Card });
export type CardUpdated = z.infer<typeof CardUpdated>;

/** The board commands; index.ts spreads them into `Command`. */
export const boardCommands = [
  cmd(
    "card.create",
    z.object({
      projectId: z.string(),
      title: z.string().min(1),
      description: z.string(),
      /** The column the card is born in; the Backlog when absent (an older daemon ignores it). */
      column: BoardColumn.optional(),
      /** Issue #1201: a card template of the project; the host fills the card from it. */
      templateId: z.string().min(1).max(60).optional(),
      ...CardDeps,
    }),
  ),
  cmd("card.templates", z.object({ projectId: z.string() })),
  /**
   * Issue #1361: turns the card's check loop on or off. Outside bypassPermissions it turns on only
   * with `confirm`, which needs a near connection; off always works.
   */
  cmd(
    "card.checkLoop",
    z
      .object({
        cardId: z.string().min(1),
        on: z.boolean(),
        confirm: z.boolean().optional(),
        rounds: z.number().int().min(1).max(10).nullable().optional(),
      })
      .strict(),
  ),
  cmd(
    "card.update",
    z.object({
      cardId: z.string(),
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      /** Phase 36: `null` removes the estimate. */
      estimateHours: z.number().min(0).max(1000).nullable().optional(),
      /** Issue #78: the validation note; empty text or `null` clears it. */
      validationNote: z.string().max(4000).nullable().optional(),
      /** Issue #78: the spec file in the worktree, relative; `null` goes back to the default. */
      specPath: z
        .string()
        .max(SPEC_PATH_MAX)
        .refine((path) => specPathProblem(path) === null)
        .nullable()
        .optional(),
      /** Issue #76: the library documents pinned to the card; replaces the whole list. */
      pinnedDocs: z
        .array(
          z
            .string()
            .max(SPEC_PATH_MAX)
            .refine((path) => pinnedDocProblem(path) === null),
        )
        .max(PINNED_DOCS_MAX)
        .optional(),
      ...CardDeps,
    }),
  ),
  cmd(
    "card.move",
    z.object({
      cardId: z.string(),
      column: BoardColumn,
      position: z.number().optional(),
      /** Issue #78: move although the column's contract is not met; the card keeps a notice. */
      force: z.boolean().optional(),
    }),
  ),
  cmd("card.start", CardStartPayload),
  cmd("card.get", CardIdPayload),
  /** Issue #78: looks at the card's spec file again and answers the card. */
  cmd("card.spec", CardIdPayload),
  /** Issue #1058: the project's own shape for a validation note, or why it was not used. */
  cmd("card.validationTemplate", CardIdPayload),
  cmd("card.stop", CardIdPayload),
  cmd("card.diff", CardIdPayload),
  /** Issue #1439: a second-opinion review of the card's diff; near only. */
  cmd(
    "card.review",
    z.object({ cardId: z.string(), language: z.enum(["en", "pt-BR"]).optional() }).strict(),
  ),
  cmd("card.message", z.object({ cardId: z.string(), text: z.string().min(1) })),
  /** With `description`: the text the person confirmed for the PR, instead of the card's own. */
  cmd(
    "card.pr.create",
    z.object({
      cardId: z.string(),
      description: z.string().max(8000).optional(),
      /** Phase 40: the title the person confirmed, instead of the card's own. */
      title: z
        .string()
        .min(1)
        .max(256)
        .regex(/^[^\r\n]*$/)
        .optional(),
    }),
  ),
  /**
   * A session managing the cards of its own project through the flightdeck MCP server. The daemon
   * finds the session's project (and its own card) from where it runs; `cardId` defaults to that card.
   */
  cmd(
    "card.manage",
    z.object({
      as: SessionIdentity,
      /** The folder a terminal session runs in; a managed session's own folder wins. */
      cwd: z.string().optional(),
      action: z.enum(["move", "update", "comment", "finish"]),
      cardId: z.string().optional(),
      column: BoardColumn.optional(),
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      text: z.string().min(1).optional(),
      outcome: z.enum(["done", "discard"]).optional(),
    }),
  ),
  /**
   * #1196: merges the card's open PR on its provider (`gh pr merge`, a merge commit or a squash);
   * a near connection and `confirm`. The card then moves to Done as any merged PR does.
   */
  cmd(
    "card.pr.merge",
    z
      .object({
        cardId: z.string(),
        method: z.enum(["merge", "squash"]),
        confirm: z.boolean().optional(),
      })
      .strict(),
  ),
  cmd("card.complete", CardConfirmPayload),
  cmd("card.discard", CardConfirmPayload),
  /** Removes a card that never started; a started one is refused (use `card.discard`). */
  cmd("card.delete", CardConfirmPayload),
  cmd("card.dismissUnblocked", CardIdPayload),
  /** Issue #152: the worktrees of the cards, with their size, state and why one is kept. */
  cmd("worktree.list", z.object({ projectId: z.string().optional() }).strict()),
  /** Removes the listed worktrees that are safe to remove; the daemon checks each one again. */
  cmd(
    "worktree.remove",
    z.object({
      items: z.array(z.object({ projectId: z.string(), path: z.string() }).strict()).min(1),
      /** Like Discard and Delete: the host asks for the person's yes in the request itself. */
      confirm: z.literal(true),
    }),
  ),
  /** Phase 13: the same request in 2 to 4 variants, each in its own worktree. */
  cmd(
    "card.startArena",
    z.object({
      cardId: z.string(),
      variants: z
        .array(
          z.object({
            model: z.string().min(1).optional(),
            effort: EffortLevel.optional(),
            /** Phase 20: the persona the variant's session opens in. */
            persona: PersonaRef.optional(),
          }),
        )
        .min(2)
        .max(4),
      workflow: z.string().min(1).optional(),
      inputs: z.record(z.string(), z.string()).optional(),
    }),
  ),
  cmd("card.arena", z.object({ cardId: z.string() })),
  /** The variant becomes the card's worktree; the others are stopped and removed (`confirm`). */
  cmd(
    "card.chooseVariant",
    z.object({ cardId: z.string(), variantId: z.string(), confirm: z.boolean().optional() }),
  ),
  cmd("pr.comments", CardIdPayload),
  cmd("pr.comments.send", z.object({ cardId: z.string(), ids: z.array(z.string()).min(1) })),
  /** Rebase on the base; a conflict aborts it and leaves the worktree as it was. */
  cmd("card.updateFromBase", CardIdPayload),
  /** "Merge e arquivar", for a card without a PR; `merge` is `--no-ff`. */
  cmd(
    "card.mergeLocal",
    z.object({
      cardId: z.string(),
      mode: z.enum(["merge", "squash"]).default("merge"),
      confirm: z.boolean().optional(),
      /** Phase 40: the message the person confirmed, instead of the default one. */
      message: z
        .string()
        .min(1)
        .max(5000)
        .regex(/^[^\0]*$/)
        .optional(),
    }),
  ),
] as const;

/** The `data` of each board command's ack; `CommandResults` extends it. */
export interface BoardResults {
  "card.create": Card;
  "card.update": Card;
  "card.checkLoop": Card;
  "card.move": Card;
  "card.start": Card;
  "card.stop": Card;
  "card.diff": CardDiff;
  "card.review": CardReviewResult;
  "card.message": SessionSendResult;
  "card.pr.create": Card;
  "card.pr.merge": Card;
  "card.manage": Card;
  "card.complete": Card;
  "card.discard": Card;
  "card.delete": Card;
  "card.dismissUnblocked": Card;
  "worktree.list": WorktreesResult;
  "worktree.remove": WorktreeRemoveResult;
  "card.startArena": Arena;
  "card.arena": Arena;
  "card.chooseVariant": Card;
  "card.get": Card;
  "card.spec": Card;
  "card.validationTemplate": ValidationTemplate;
  "card.templates": CardTemplates;
  "pr.comments": { comments: PrComment[] };
  "pr.comments.send": { sent: number };
  "card.updateFromBase": Card;
  "card.mergeLocal": Card;
}
