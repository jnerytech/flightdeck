// The projects of a host and their boards: add, update, trust, detect, scan and clone (issue #1600: moved from index.ts).
import { z } from "zod";
import {
  HARNESS_DIGESTS_MAX,
  HARNESS_PREVIEW_PARTS,
  HARNESS_TEMPLATE_ID,
  type HarnessApplied,
  type HarnessCommitted,
  type HarnessDraft,
  type HarnessPreview,
  type HarnessStack,
  type HarnessTemplateInfo,
} from "./agent-setup.ts";
import { Card, IssuesConfig, PrProviderKind } from "./board.ts";
import { BoardColumn, ColumnContract } from "./board-contracts.ts";
import { cmd } from "./command.ts";
import { isBranchName } from "./git-ref.ts";
import { AutoApproveSettings } from "./permissions.ts";
import { PersonaSubagentsMode } from "./personas.ts";

export const Project = z.object({
  id: z.string(),
  path: z.string(),
  name: z.string(),
  baseBranch: z.string(),
  /**
   * The base branch is not a branch name (an older daemon stored it without checking): opening a PR
   * and updating from the remote refuse it, and every git step refuses an option, until the person
   * sets a real one (issue #369).
   */
  baseBranchInvalid: z.boolean().optional(),
  prProvider: PrProviderKind,
  /** The only shell command Flightdeck runs on its own, and only when registered. */
  setupScript: z.string().nullable(),
  /** Appended to the prompt of every card. */
  promptTemplate: z.string(),
  /** The repository has a `.worktreeinclude` (phase 11): the app suggests one when it has not. */
  worktreeInclude: z.boolean().default(false),
  /** Phase 13; filled in when an older daemon does not send it. */
  autoApprove: AutoApproveSettings.default(() => AutoApproveSettings.parse({})),
  /** Phase 13: `null` when the project has no issue integration. */
  issues: IssuesConfig.nullable().default(null),
  /** The persona a card opens its session in when it starts from that column (phase 20). */
  personaByColumn: z.partialRecord(BoardColumn, z.string()).default({}),
  /** Issue #78: what each column asks of a card; a column left out keeps the app's default. */
  contractByColumn: z.partialRecord(BoardColumn, ColumnContract).default({}),
  /** The personas offered as `persona-<id>` subagents in this project (phase 20). */
  personaSubagents: PersonaSubagentsMode.default("all"),
  /** Phase 36: the hours a done card is worth when it has no estimate of its own. */
  defaultHours: z.number().nullable().default(null),
  /** Phase 36: the optional value signals this project has switched on (both off by default). */
  roiSignals: z
    .object({ commits: z.boolean(), issues: z.boolean() })
    .default({ commits: false, issues: false }),
  /**
   * Phase 29: the project key of the folder (the normalized remote, else the folder on this host),
   * the same one sessions and costs carry; absent from a daemon that does not send it.
   */
  projectKey: z.string().optional(),
});
export type Project = z.infer<typeof Project>;

/** What `projects.scan` answers: the repositories found, never outside the roots. */
export interface ProjectsScanResult {
  repos: Array<{ name: string; path: string; root: string }>;
  /** The scan stopped at its cap of repositories or of folders visited. */
  truncated: boolean;
}

/** What `projects.clone` answers: the new repository's folder. */
export interface ProjectsCloneResult {
  path: string;
}

const ProjectFields = {
  name: z.string().min(1).optional(),
  /** A branch name git accepts, and never one that starts with `-` (issue #345). */
  baseBranch: z.string().refine(isBranchName, "not a valid branch name").optional(),
  prProvider: PrProviderKind.optional(),
  /** `null` or blank removes the script. */
  setupScript: z.string().nullable().optional(),
  promptTemplate: z.string().optional(),
  /** Phase 13: fields left out keep their value. */
  autoApprove: AutoApproveSettings.partial().optional(),
  /** `null` removes the integration. */
  issues: IssuesConfig.nullable().optional(),
};

export const ProjectAddPayload = z.object({ path: z.string().min(1), ...ProjectFields });

export const ProjectUpdatePayload = z.object({
  projectId: z.string(),
  ...ProjectFields,
  /** The default persona by column; `null` removes the one of a column. */
  personaByColumn: z.partialRecord(BoardColumn, z.string().nullable()).optional(),
  /** Issue #78: `null` gives a column back to the default contract. */
  contractByColumn: z.partialRecord(BoardColumn, ColumnContract.nullable()).optional(),
  personaSubagents: PersonaSubagentsMode.optional(),
  /** Phase 36: `null` removes the default. */
  defaultHours: z.number().min(0).max(1000).nullable().optional(),
  /** Phase 36: which optional value signals are on; a field left out keeps its value. */
  roiSignals: z
    .object({ commits: z.boolean().optional(), issues: z.boolean().optional() })
    .strict()
    .optional(),
});

/** Issue #196: whether a folder is trusted, and through which record (a parent folder may be the one). */
export const ProjectTrustState = z.object({
  path: z.string(),
  trusted: z.boolean(),
  via: z.string().nullable(),
  /** Issue #463: live sessions in the folder that still run with the setup they loaded before the trust was revoked; absent when none. */
  staleSessions: z.number().int().positive().optional(),
});
export type ProjectTrustState = z.infer<typeof ProjectTrustState>;

export const ProjectTrustStates = z.object({ items: z.array(ProjectTrustState) });
export type ProjectTrustStates = z.infer<typeof ProjectTrustStates>;

/** What a project's own files would load into a session, read without running anything. */
export const ProjectLoad = z.object({
  path: z.string(),
  hooks: z.array(z.object({ event: z.string(), file: z.string(), commands: z.array(z.string()) })),
  mcpServers: z.array(z.object({ name: z.string(), file: z.string(), command: z.string() })),
  envKeys: z.array(z.string()),
  allowRules: z.array(z.string()),
  /** What the settings deny (#75); absent from a host older than it. */
  denyRules: z.array(z.string()).optional(),
  defaultMode: z.string().nullable(),
  agents: z.array(z.string()),
  skills: z.array(z.string()),
  commands: z.array(z.string()),
  claudeMd: z.boolean(),
  /** Settings that name a program to run (apiKeyHelper, statusLine, ...): the whole command. */
  executables: z.array(z.object({ key: z.string(), file: z.string(), command: z.string() })),
  /** Environment variables that send traffic or code elsewhere (a base URL, a proxy, NODE_OPTIONS): the value too. */
  redirects: z.array(z.object({ key: z.string(), file: z.string(), value: z.string() })),
  /** Plugins and marketplaces the settings turn on or add. */
  plugins: z.array(z.string()),
  /** Settings keys present that this listing does not explain, so a key it does not know is still named. */
  otherKeys: z.array(z.string()),
  /** Agent, skill and command files whose header carries hooks, servers or tool grants. */
  extras: z.array(z.object({ file: z.string(), keys: z.array(z.string()) })),
  unreadable: z.array(z.string()),
  /** How many entries of each list were left out because the list is capped: the screen must say so. */
  omitted: z.object({
    hooks: z.number().int().min(0),
    mcpServers: z.number().int().min(0),
    allowRules: z.number().int().min(0),
    denyRules: z.number().int().min(0).optional(),
    envKeys: z.number().int().min(0),
  }),
});
export type ProjectLoad = z.infer<typeof ProjectLoad>;

export const BoardSettings = z.object({ maxParallelRuns: z.number().int().min(1) });
export type BoardSettings = z.infer<typeof BoardSettings>;

/** Issue #1568: what looking at the project's remote did (`project.detectProvider`). */
export const ProjectDetectResult = z.object({
  /** The project as it is now: with the provider set when the outcome is `set`. */
  project: Project,
  /**
   * `set`: GitHub or Azure DevOps was found and saved. `kept`: the project had a provider already.
   * `no_remote`: the repository has no `origin`. `unsupported`: it has one, on another service (or
   * a GitHub Enterprise server, which is set by hand). `unreadable`: git could not read the repository.
   */
  outcome: z.enum(["set", "kept", "no_remote", "unsupported", "unreadable"]),
  /** The remote's host name (`gitlab.com`), for `unsupported`; never the address with its path or credentials. */
  host: z.string().nullable(),
});
export type ProjectDetectResult = z.infer<typeof ProjectDetectResult>;

export const ProjectListResult = z.object({
  projects: z.array(Project),
  /** Host-wide limit of cards running at the same time. */
  maxParallelRuns: z.number().int().min(1),
});
export type ProjectListResult = z.infer<typeof ProjectListResult>;

export const BoardResult = z.object({
  project: Project,
  /** The five columns, in board order, each with its cards by position. */
  columns: z.array(z.object({ column: BoardColumn, cards: z.array(Card) })),
});
export type BoardResult = z.infer<typeof BoardResult>;

const harnessDigests = z
  .record(z.string().max(256), z.string().max(128))
  .refine((digests) => Object.keys(digests).length <= HARNESS_DIGESTS_MAX);

/** The projects commands; index.ts spreads them into `Command`. */
export const projectsCommands = [
  cmd("project.list", z.object({}).strict()),
  cmd("project.add", ProjectAddPayload),
  cmd("project.update", ProjectUpdatePayload),
  /**
   * Issue #1568 (host `prDetect`): when the project has no PR provider, reads its `origin` remote and
   * sets GitHub or Azure DevOps from it. Never returns the remote's address, only its host name.
   */
  cmd("project.detectProvider", z.object({ projectId: z.string() }).strict()),
  /** Issue #196: which folders may bring their own hooks, MCP servers and settings into a managed session. */
  cmd(
    "project.trust.state",
    z.object({ paths: z.array(z.string().min(1).max(4096)).min(1).max(200) }).strict(),
  ),
  cmd("project.trust.inspect", z.object({ path: z.string().min(1).max(4096) }).strict()),
  /** #75: the project's stack and its test, lint, format and build commands, read, never run. */
  cmd("project.harness.stack", z.object({ path: z.string().min(1).max(4096) }).strict()),
  cmd(
    "project.harness.preview",
    z
      .object({
        path: z.string().min(1).max(4096),
        parts: z.array(z.enum(HARNESS_PREVIEW_PARTS)).min(1).max(HARNESS_PREVIEW_PARTS.length),
        /** #75, slice T1b: a host template's Markdown instead of the fixed files. */
        template: z.string().regex(HARNESS_TEMPLATE_ID).optional(),
      })
      .strict(),
  ),
  /**
   * #75, slice T1: shares the project's Markdown harness (CLAUDE.md, agents, skills; never settings)
   * as a host template `id`: read without a link, scanned for secrets, written all or nothing.
   */
  cmd(
    "project.harness.export",
    z
      .object({
        path: z.string().min(1).max(4096),
        id: z.string().min(1).max(40),
        // Shown in every client's list: words, not blank, no control character or line break.
        title: z
          .string()
          .min(1)
          .max(80)
          .refine((title) => title.trim() !== "" && !/\p{Cc}/u.test(title)),
      })
      .strict(),
  ),
  /**
   * #75, slice G1: drafts a CLAUDE.md with the host's model from the detected stack and the
   * project's top-level names (never a file's content). The host holds the draft; an apply whose
   * digest for CLAUDE.md is the draft's writes it. Never hooks or permissions from a model.
   */
  cmd(
    "project.harness.draft",
    z.object({ path: z.string().min(1).max(4096), part: z.literal("claudeMd") }).strict(),
  ),
  /**
   * #75, slice C1: commits what `project.harness.apply` wrote (by its `digests`) on a new branch the
   * host names, through a temporary index: the person's branch, index and files stay as they are.
   */
  cmd(
    "project.harness.commit",
    z
      .object({
        path: z.string().min(1).max(4096),
        digests: harnessDigests,
        confirm: z.boolean().optional(),
      })
      .strict(),
  ),
  /**
   * #75, slice S4: writes what the preview proposed. The daemon makes the proposals again and never
   * takes content from the app; `digests` (each proposal's, by path) must match them all, else
   * `harness_stale`. Writing hooks lets commands run in sessions: a near connection and `confirm`.
   */
  cmd(
    "project.harness.apply",
    z
      .object({
        path: z.string().min(1).max(4096),
        parts: z.array(z.enum(HARNESS_PREVIEW_PARTS)).min(1).max(HARNESS_PREVIEW_PARTS.length),
        digests: harnessDigests,
        confirm: z.boolean().optional(),
        /** The person accepted the settings being rewritten with another layout (the preview's `reformats`). */
        reformat: z.boolean().optional(),
        /** #75, slice T1b: a host template's Markdown instead of the fixed files. */
        template: z.string().regex(HARNESS_TEMPLATE_ID).optional(),
      })
      .strict(),
  ),
  cmd(
    "project.trust.set",
    z.object({ path: z.string().min(1).max(4096), trusted: z.boolean() }).strict(),
  ),
  cmd("board.get", z.object({ projectId: z.string() })),
  /** Host-wide board settings; without fields it only reads them. */
  cmd("board.settings", z.object({ maxParallelRuns: z.number().int().min(1).optional() })),
  cmd("board.watch", z.object({}).strict()),
  /** Git repositories inside the allowed roots (bounded depth and count), for "find my projects". */
  cmd("projects.scan", z.object({ depth: z.number().int().min(1).max(3).optional() }).strict()),
  /** Clones a repository into a folder inside the allowed roots; a refusal carries its reason. */
  cmd(
    "projects.clone",
    z
      .object({
        url: z.string().min(1).max(2048),
        root: z.string().min(1),
        name: z.string().min(1).max(100).optional(),
      })
      .strict(),
  ),
] as const;

/** The `data` of each projects command's ack; `CommandResults` extends it. */
export interface ProjectsResults {
  "project.list": ProjectListResult;
  "project.add": Project;
  "project.update": Project;
  "project.detectProvider": ProjectDetectResult;
  "board.get": BoardResult;
  "board.settings": BoardSettings;
  "project.trust.state": ProjectTrustStates;
  "project.trust.inspect": ProjectLoad;
  "project.harness.stack": HarnessStack;
  "project.harness.preview": HarnessPreview;
  "project.harness.apply": HarnessApplied;
  "project.harness.commit": HarnessCommitted;
  "project.harness.draft": HarnessDraft;
  "project.harness.export": HarnessTemplateInfo;
  "project.trust.set": ProjectTrustState;
  "board.watch": undefined;
  "projects.scan": ProjectsScanResult;
  "projects.clone": ProjectsCloneResult;
}
