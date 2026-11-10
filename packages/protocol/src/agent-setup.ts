// The Agent setup context: what a session starts with, its MCP servers, agent files, memory, plugins, library, harness, task templates and context budget (issue #1600: moved from index.ts).
import { z } from "zod";
import { cmd } from "./command.ts";
import { LocalizedText } from "./localized-text.ts";
import { PermissionMode } from "./permissions.ts";
import { BudgetSource } from "./usage.ts";

/** Issue #76: a project's library of PRDs, RFCs, ADRs and specs, each with a lifecycle status. */
export const KnowledgeStatus = z.enum(["valid", "transitional", "obsolete"]);
export type KnowledgeStatus = z.infer<typeof KnowledgeStatus>;

export const KnowledgeType = z.enum(["prd", "rfc", "adr", "spec"]);

/** The kinds of document a template exists for (issue #1039). */
/** The longest body `knowledge.create` takes, in characters. */
export const KNOWLEDGE_BODY_MAX = 100_000;

export const KnowledgeKind = z.enum(["adr", "rfc", "prd"]);
export type KnowledgeKind = z.infer<typeof KnowledgeKind>;

export type KnowledgeType = z.infer<typeof KnowledgeType>;

export interface KnowledgeEntry {
  /** Relative to the project, with `/`. */
  path: string;
  title: string;
  type: KnowledgeType | null;
  /** `unclassified`: no status in its front matter, so agents are not given it. */
  status: KnowledgeStatus | "unclassified";
  /** The document this one replaces, as a project path. */
  supersedes: string | null;
  bytes: number;
  /** ISO time of the last change. */
  changedAt: string;
  /** What is wrong with the document itself, as codes (`status_unknown`, `supersedes_missing`, ...). */
  problems: string[];
  /** A valid document that points at an obsolete one: `references_obsolete:<path>`. */
  warnings: string[];
  /** What the list read of the file (its size and start); `knowledge.setStatus` writes only if it still holds. */
  hash: string;
}

export interface KnowledgeListResult {
  entries: KnowledgeEntry[];
  /** More documents than the list holds. */
  truncated: boolean;
}

/** Whether sessions in a project are given the library's index, and why not. */
export interface KnowledgeFeedState {
  /** Not switched off: the project, or a folder above it, is not in the host's `knowledge.feedOff`. */
  on: boolean;
  /** The project is trusted. An untrusted project is not given the index, on or off. */
  trusted: boolean;
  /** The folder in `knowledge.feedOff` that switches it off; the project itself, or one above it. */
  offBy: string | null;
  /** `offBy` is the project itself (under any name of it), so the project's own switch can turn it on. */
  own: boolean;
}

/** What a session is given of the library: Markdown for its system prompt, empty when it is not given any. */
export interface KnowledgeIndexResult {
  text: string;
  /** Documents named in the text. */
  fed: number;
  /** Documents that qualify were left out to stay under the cap. */
  truncated: boolean;
}

/** What a template asks the person for: one of a folder, a file, a short text or a choice. */
export const TemplateField = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,23}$/),
    kind: z.enum(["folder", "file", "text", "choice"]),
    label: LocalizedText,
    optional: z.boolean().optional(),
    choices: z.array(z.object({ id: z.string().min(1), label: LocalizedText })).optional(),
  })
  .superRefine((field, ctx) => {
    const count = field.choices?.length ?? 0;
    if (field.kind === "choice" ? count < 2 : count > 0) {
      ctx.addIssue({
        code: "custom",
        message: "a choice has two or more options; other fields have none",
        path: ["choices"],
      });
    }
  });
export type TemplateField = z.infer<typeof TemplateField>;

/** How far Claude may go: never beyond editing the chosen folder. */
export const TemplatePreset = z.enum(["read_only", "ask_before_changes", "edit_folder"]);
export type TemplatePreset = z.infer<typeof TemplatePreset>;

/** The `{name}` placeholders a text holds. */
export const placeholdersOf = (text: string): string[] =>
  [...text.matchAll(/\{([a-z][a-z0-9_]*)\}/g)].map((match) => match[1] as string);

/** A template of a simple-mode task: what to ask, the prompt to fill and how far Claude may go. */
export const Template = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
    title: LocalizedText,
    description: LocalizedText,
    icon: z.string().min(1),
    /** One to three fields, each asked once. */
    fields: z.array(TemplateField).min(1).max(3),
    prompt: LocalizedText,
    preset: TemplatePreset,
    planFirst: z.boolean(),
    /** Where the results go, relative to the chosen folder; `Flightdeck results` when absent. */
    outputFolder: z.string().optional(),
  })
  .superRefine((template, ctx) => {
    const ids = template.fields.map((field) => field.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", message: "two fields share an id", path: ["fields"] });
    }
    for (const language of ["en", "pt-BR"] as const) {
      const unknown = placeholdersOf(template.prompt[language]).filter((id) => !ids.includes(id));
      if (unknown.length > 0) {
        ctx.addIssue({
          code: "custom",
          message: `the prompt names fields that do not exist: ${unknown.join(", ")}`,
          path: ["prompt", language],
        });
      }
    }
  });
export type Template = z.infer<typeof Template>;

/** A template file the host could not load, and why (the doctor shows it too). */
export const TemplateProblem = z.object({ file: z.string(), reason: z.string() });
export type TemplateProblem = z.infer<typeof TemplateProblem>;

/** The built-in templates and the host's own, and the files that did not load. */
export const TemplateListResult = z.object({
  templates: z.array(Template),
  problems: z.array(TemplateProblem),
});
export type TemplateListResult = z.infer<typeof TemplateListResult>;

/** A file a task made or changed. */
export const TaskFile = z.object({
  /** Absolute, inside the task's working folder. */
  path: z.string(),
  name: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  modifiedAt: z.string(),
  change: z.enum(["new", "changed"]),
});
export type TaskFile = z.infer<typeof TaskFile>;

/** What a task produced: its files, newest first, and whether the list was cut short. */
export const TaskResultsResult = z.object({ files: z.array(TaskFile), truncated: z.boolean() });
export type TaskResultsResult = z.infer<typeof TaskResultsResult>;

/** The start of a text file a task made, to show before opening it. */
export const TaskPreviewResult = z.object({ text: z.string(), truncated: z.boolean() });
export type TaskPreviewResult = z.infer<typeof TaskPreviewResult>;

/** A task started from a template: its session, where it works and where its results go. */
export const TemplateStartResult = z.object({
  sessionId: z.string(),
  workingFolder: z.string(),
  outputFolder: z.string(),
  permissionMode: PermissionMode,
});
export type TemplateStartResult = z.infer<typeof TemplateStartResult>;

/** Phase 12: an MCP server as `.mcp.json` holds it. */
export const McpServerInput = z.object({
  name: z.string().min(1),
  type: z.enum(["stdio", "http", "sse"]).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

/** An MCP server that applies to a project, secrets masked. */
export const McpServerView = McpServerInput.extend({
  origin: z.enum(["project", "user", "user-project"]),
  readOnly: z.boolean(),
  transport: z.enum(["stdio", "http", "sse"]),
  enabled: z.boolean(),
});
export type McpServerView = z.infer<typeof McpServerView>;

/** Phase 12: the live state of one MCP server of a managed session. */
export const McpLiveStatus = z.object({
  name: z.string(),
  status: z.enum(["connected", "failed", "needs-auth", "pending", "disabled"]),
  error: z.string().optional(),
});
export type McpLiveStatus = z.infer<typeof McpLiveStatus>;

/** Phase 12: what `agentcfg.*` edits. */
export const AgentCfgKind = z.enum(["claudemd", "agent", "skill"]);

const AgentCfgOrigin = z.enum(["project", "user"]);

/** A CLAUDE.md, agent or skill; the user's (~/.claude) are read-only. */
export const AgentCfgItem = z.object({
  kind: AgentCfgKind,
  /** Relative to the project, or to ~/.claude for the user's. */
  path: z.string(),
  origin: AgentCfgOrigin,
  readOnly: z.boolean(),
  /** sha256 of the file's bytes, to send back as `expectedHash`. */
  hash: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
});
export type AgentCfgItem = z.infer<typeof AgentCfgItem>;

/** Phase 26: the auto memory of a project (`~/.claude/projects/<project>/memory`). */
export const MemoryFile = z.object({
  name: z.string(),
  /** sha256 of the file's bytes, to send back as `expectedHash`. */
  hash: z.string(),
  bytes: z.number().int().nonnegative(),
  lines: z.number().int().nonnegative(),
  type: z.string().optional(),
  description: z.string().optional(),
  /** `MEMORY.md` mentions the file (the index itself counts). */
  inIndex: z.boolean(),
});
export type MemoryFile = z.infer<typeof MemoryFile>;

export const MemoryListing = z.object({
  dir: z.string(),
  exists: z.boolean(),
  files: z.array(MemoryFile),
});
export type MemoryListing = z.infer<typeof MemoryListing>;

export const ContextBudget = z.object({
  sources: z.array(BudgetSource),
  startTokens: z.number().int().nonnegative(),
  memory: z.object({
    limitLines: z.number().int(),
    limitBytes: z.number().int(),
    indexLines: z.number().int().nonnegative(),
    indexBytes: z.number().int().nonnegative(),
    loadedLines: z.number().int().nonnegative(),
    loadedBytes: z.number().int().nonnegative(),
    /** What stopped the loading of the index; null when all of it fits. */
    cutBy: z.enum(["lines", "bytes"]).nullable(),
    leftOutLines: z.array(z.string()),
    leftOutFiles: z.array(z.string()),
  }),
});
export type ContextBudget = z.infer<typeof ContextBudget>;

/** A cleanup the screen suggests; the memory is never edited because of it. */
export const MemorySuggestion = z.object({
  kind: z.enum(["duplicate", "broken-link", "orphan", "stale", "contradiction"]),
  files: z.array(z.string()),
  /** The index line behind a broken link. */
  detail: z.string().optional(),
});
export type MemorySuggestion = z.infer<typeof MemorySuggestion>;

/** Phase 26: what a plugin installs, read from its folder (nothing is run). */
export const PluginInventory = z.object({
  manifest: z
    .object({
      name: z.string().optional(),
      version: z.string().optional(),
      description: z.string().optional(),
      author: z.string().optional(),
    })
    .nullable(),
  hooks: z.array(
    z.object({
      event: z.string(),
      matcher: z.string().optional(),
      type: z.string(),
      command: z.string().optional(),
      /** Listens to PreToolUse or PermissionRequest: it can decide for the user. */
      sensitive: z.boolean(),
    }),
  ),
  monitors: z.array(
    z.object({ name: z.string(), command: z.string(), description: z.string(), when: z.string() }),
  ),
  skills: z.array(z.string()),
  agents: z.array(z.string()),
  commands: z.array(z.string()),
  mcpServers: z.array(z.object({ name: z.string(), transport: z.string(), target: z.string() })),
  attention: z.boolean(),
  /** sha256 of the whole content: a confirmation repeats it. */
  hash: z.string(),
  files: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  problems: z.array(z.string()),
});
export type PluginInventory = z.infer<typeof PluginInventory>;

/** A version fixed by the person: updates are refused until it is let go. */
export const PluginPin = z.object({ version: z.string(), hash: z.string(), at: z.string() });
export type PluginPin = z.infer<typeof PluginPin>;

export const InstalledPlugin = z.object({
  id: z.string(),
  name: z.string(),
  marketplace: z.string(),
  version: z.string(),
  scope: z.string(),
  enabled: z.boolean(),
  path: z.string(),
  pinned: PluginPin.nullable(),
  inventory: PluginInventory.nullable(),
  errors: z.array(z.string()),
});
export type InstalledPlugin = z.infer<typeof InstalledPlugin>;

export const PluginList = z.object({
  installed: z.array(InstalledPlugin),
  available: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      marketplace: z.string(),
      description: z.string().optional(),
      version: z.string().optional(),
    }),
  ),
  marketplaces: z.array(
    z.object({
      name: z.string(),
      source: z.string(),
      origin: z.string().optional(),
      location: z.string().optional(),
    }),
  ),
});
export type PluginList = z.infer<typeof PluginList>;

export const PluginPreview = z.object({
  plugin: z.string(),
  version: z.string().optional(),
  /** Null when the content cannot be shown (a plugin fetched from another repository). */
  inventory: PluginInventory.nullable(),
  hash: z.string().nullable(),
  reason: z.literal("not-local").optional(),
  validation: z.object({ success: z.boolean(), errors: z.array(z.string()) }).optional(),
});
export type PluginPreview = z.infer<typeof PluginPreview>;

const PluginDelta = z.object({ added: z.array(z.string()), removed: z.array(z.string()) });

export const PluginUpdatePreview = z.object({
  plugin: z.string(),
  from: z.object({ version: z.string(), hash: z.string() }),
  to: z.object({ version: z.string(), hash: z.string() }),
  inventory: PluginInventory,
  diff: z.object({
    hooks: PluginDelta,
    monitors: PluginDelta,
    skills: PluginDelta,
    agents: PluginDelta,
    commands: PluginDelta,
    mcpServers: PluginDelta,
  }),
  unchanged: z.boolean(),
});
export type PluginUpdatePreview = z.infer<typeof PluginUpdatePreview>;

/** What a change that went to the CLI came to. */
export const PluginChange = z.object({
  outcome: z.enum(["ok", "failed", "unchanged", "needs-command-confirmation", "rolled-back"]),
  message: z.string(),
  /** A command the marketplace declares: only this `sha256`, sent back after the person saw it, accepts it. */
  shownCommand: z
    .object({
      command: z.string().optional(),
      plugin: z.string().optional(),
      sha256: z.string(),
    })
    .optional(),
});
export type PluginChange = z.infer<typeof PluginChange>;

/** #75: the parts the harness preview has a template for (MCP has none: its servers are the person's choice). */
export const HARNESS_PREVIEW_PARTS = [
  "claudeMd",
  "hooks",
  "skills",
  "agents",
  "permissions",
] as const;

/** #75, slice T1: a host harness template's id, which is its folder's name: lower case, no dot or slash. */
export const HARNESS_TEMPLATE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** #75, slice T1b: the most digests a harness apply or commit takes: a template's 16 files and the settings. */
export const HARNESS_DIGESTS_MAX = 17;

/** #75: what a project is built with, and the fixed commands that test, lint, format and build it. */
export const HarnessStack = z.object({
  stacks: z.array(z.enum(["node", "python", "go", "rust", "dotnet"])),
  commands: z.object({
    test: z.string().nullable(),
    lint: z.string().nullable(),
    format: z.string().nullable(),
    build: z.string().nullable(),
  }),
});
export type HarnessStack = z.infer<typeof HarnessStack>;

/**
 * #75, slice S3: what applying the chosen parts would add. For `.claude/settings.json`, only the
 * entries that would be appended, never the file's text (it may hold `env` values); `conflicts` names
 * a key already there with another shape, left as it is. A new file is created only when missing.
 */
export const HarnessPreview = z.object({
  settings: z
    .object({
      path: z.literal(".claude/settings.json"),
      /** sha256 of the file as previewed; null when there is none yet. */
      hash: z.string().nullable(),
      hooks: z.array(z.object({ event: z.string(), matcher: z.string(), command: z.string() })),
      denyRules: z.array(z.string()),
      conflicts: z.array(z.string()),
      /** Writing the file back would change its layout, not only add entries. */
      reformats: z.boolean(),
      /** Binds the file's hash and what would be added: apply refuses when it differs (S4). */
      digest: z.string(),
    })
    .nullable(),
  /** A new file, whole; `digest` is the sha256 of `content`. */
  files: z.array(z.object({ path: z.string(), content: z.string(), digest: z.string() })),
  unreadable: z.array(z.string()),
  /**
   * #75, slice T1b: a template's files not proposed, by project path: front matter that could run a
   * command or grant a permission, a secret, an import from outside the project, or a command a skill
   * runs as it loads (`` !`cmd` ``). Only with a template.
   */
  withheld: z
    .array(
      z.object({
        path: z.string(),
        reason: z.enum(["frontmatter", "secret", "import", "command"]),
      }),
    )
    .optional(),
});
export type HarnessPreview = z.infer<typeof HarnessPreview>;

/** #75, slice S4: the project files `project.harness.apply` wrote, in the preview's order. */
export const HarnessApplied = z.object({
  written: z.array(z.string()),
  /** #75, slice C1: the sha256 of each file as written, by path, for `project.harness.commit`. */
  digests: z.record(z.string(), z.string()).optional(),
});
export type HarnessApplied = z.infer<typeof HarnessApplied>;

/** #75, slice T1: a host template of a project's Markdown harness: its names, never its content. */
export const HarnessTemplateInfo = z.object({
  id: z.string(),
  title: z.string(),
  /** Paths inside the template: `CLAUDE.md`, `agents/<name>.md`, `skills/<name>/SKILL.md`. */
  files: z.array(z.string()),
  bytes: z.number().int(),
});
export type HarnessTemplateInfo = z.infer<typeof HarnessTemplateInfo>;

/** #75, slice G1: a CLAUDE.md drafted by the host's model, held by the host by its digest. */
export const HarnessDraft = z.object({
  path: z.literal("CLAUDE.md"),
  content: z.string(),
  digest: z.string(),
});
export type HarnessDraft = z.infer<typeof HarnessDraft>;

/** #75, slice C1: the branch made, its commit, and the files it holds. */
export const HarnessCommitted = z.object({
  branch: z.string(),
  commit: z.string(),
  files: z.array(z.string()),
});
export type HarnessCommitted = z.infer<typeof HarnessCommitted>;

/** The agentSetup commands; index.ts spreads them into `Command`. */
export const agentSetupCommands = [
  /** #75, slice T1: the host's harness templates: names and sizes, never content. */
  cmd("harness.templates.list", z.object({}).strict()),
  /**
   * #75, slice T2: deletes the host's harness template `id` (its folder, and nothing outside it).
   * A near connection, and only once the person confirmed.
   */
  cmd(
    "harness.templates.delete",
    z
      .object({ id: z.string().regex(HARNESS_TEMPLATE_ID), confirm: z.boolean().optional() })
      .strict(),
  ),
  /** Phase 12: the project's MCP servers; writes only to its .mcp.json and settings.local.json. */
  cmd("mcp.list", z.object({ projectId: z.string() })),
  /** Without confirm, only the exact command (or URL) that would run. */
  cmd(
    "mcp.test",
    z.object({ projectId: z.string(), name: z.string(), confirm: z.boolean().optional() }),
  ),
  cmd(
    "mcp.save",
    z.object({ projectId: z.string(), server: McpServerInput, confirm: z.boolean().optional() }),
  ),
  cmd(
    "mcp.remove",
    z.object({ projectId: z.string(), name: z.string(), confirm: z.boolean().optional() }),
  ),
  cmd(
    "mcp.toggle",
    z.object({
      projectId: z.string(),
      name: z.string(),
      enabled: z.boolean(),
      confirm: z.boolean().optional(),
      /** A live managed session to switch right away too. */
      sessionId: z.string().optional(),
    }),
  ),
  /** Phase 12: the MCP servers of a live managed session, as its runtime reports them. */
  cmd("mcp.status", z.object({ sessionId: z.string() })),
  /** Phase 12: the project's CLAUDE.md files, agents and skills; writes only inside the project. */
  cmd("agentcfg.list", z.object({ projectId: z.string(), kind: AgentCfgKind })),
  cmd(
    "agentcfg.read",
    z.object({
      projectId: z.string(),
      kind: AgentCfgKind,
      path: z.string().min(1),
      origin: AgentCfgOrigin.optional(),
    }),
  ),
  /** `expectedHash` is the hash read when the file was opened; null creates a new file. */
  cmd(
    "agentcfg.write",
    z.object({
      projectId: z.string(),
      kind: AgentCfgKind,
      path: z.string().min(1),
      content: z.string(),
      expectedHash: z.string().nullable(),
      confirm: z.boolean().optional(),
      origin: AgentCfgOrigin.optional(),
    }),
  ),
  /** Phase 26: the project's auto memory. Writes need `confirm` and the hash that was opened. */
  cmd("memory.list", z.object({ projectId: z.string() }).strict()),
  cmd("memory.read", z.object({ projectId: z.string(), name: z.string().min(1) }).strict()),
  cmd(
    "memory.write",
    z
      .object({
        projectId: z.string(),
        name: z.string().min(1),
        content: z.string(),
        expectedHash: z.string().nullable(),
        confirm: z.boolean().optional(),
      })
      .strict(),
  ),
  cmd(
    "memory.delete",
    z
      .object({
        projectId: z.string(),
        name: z.string().min(1),
        expectedHash: z.string(),
        confirm: z.boolean().optional(),
      })
      .strict(),
  ),
  cmd("memory.budget", z.object({ projectId: z.string() }).strict()),
  cmd("memory.suggest", z.object({ projectId: z.string() }).strict()),
  /** Phase 26: the Claude Code plugins of the host, through the `claude plugin` CLI. */
  cmd("plugins.list", z.object({}).strict()),
  cmd("plugins.detail", z.object({ plugin: z.string().min(1) }).strict()),
  /** What an install would bring: a plugin of a marketplace (`name@marketplace`) or a local folder. */
  cmd(
    "plugins.preview",
    z
      .object({ plugin: z.string().min(1).optional(), dir: z.string().min(1).optional() })
      .strict()
      .refine((p) => (p.plugin === undefined) !== (p.dir === undefined), {
        message: "give plugin or dir, one of the two",
      }),
  ),
  cmd("plugins.previewUpdate", z.object({ plugin: z.string().min(1) }).strict()),
  /** `confirmHash` is the hash of the content that was shown; `acceptCommand` the sha256 of a shown command. */
  cmd(
    "plugins.install",
    z
      .object({
        plugin: z.string().min(1).optional(),
        dir: z.string().min(1).optional(),
        scope: z.enum(["user", "project", "local"]).optional(),
        confirmHash: z.string().min(1),
        acceptCommand: z.string().min(1).optional(),
      })
      .strict()
      .refine((p) => (p.plugin === undefined) !== (p.dir === undefined), {
        message: "give plugin or dir, one of the two",
      }),
  ),
  cmd(
    "plugins.update",
    z
      .object({
        plugin: z.string().min(1),
        confirmHash: z.string().min(1),
        acceptCommand: z.string().min(1).optional(),
      })
      .strict(),
  ),
  cmd(
    "plugins.uninstall",
    z
      .object({
        plugin: z.string().min(1),
        scope: z.enum(["user", "project", "local"]).optional(),
        confirm: z.boolean().optional(),
      })
      .strict(),
  ),
  cmd("plugins.pin", z.object({ plugin: z.string().min(1), pinned: z.boolean() }).strict()),
  cmd(
    "plugins.marketplaceAdd",
    z
      .object({
        source: z.string().min(1),
        scope: z.enum(["user", "project", "local"]).optional(),
        confirm: z.boolean().optional(),
      })
      .strict(),
  ),
  cmd(
    "plugins.marketplaceRemove",
    z.object({ name: z.string().min(1), confirm: z.boolean().optional() }).strict(),
  ),
  cmd("plugins.marketplaceUpdate", z.object({ name: z.string().min(1).optional() }).strict()),
  cmd("template.list", z.object({}).strict()),
  cmd("task.results", z.object({ sessionId: z.string().min(1) }).strict()),
  cmd("task.preview", z.object({ sessionId: z.string().min(1), path: z.string().min(1) }).strict()),
  cmd(
    "template.start",
    z
      .object({
        templateId: z.string().min(1),
        /** The language the prompt is written in (the app's). */
        language: z.enum(["en", "pt-BR"]),
        /** What the person answered, by field id: a path, a text or the id of an option. */
        values: z.record(z.string(), z.string()),
        name: z.string().min(1).max(100).optional(),
      })
      .strict(),
  ),
  /** Issue #76: the library of documents of the project at `path`, read only. */
  cmd("knowledge.list", z.object({ path: z.string().min(1).max(4096) }).strict()),
  /** Issue #76: the index of the project's current documents that a session is given in its system prompt. */
  cmd("knowledge.index", z.object({ path: z.string().min(1).max(4096) }).strict()),
  /** Issue #76: whether sessions in the project at `path` are given that index. */
  cmd("knowledge.feed", z.object({ path: z.string().min(1).max(4096) }).strict()),
  /** Issue #76: the `status:` line of one library document, written only if the file is as it was listed. */
  cmd(
    "knowledge.setStatus",
    z
      .object({
        path: z.string().min(1).max(4096),
        file: z.string().min(1).max(512),
        status: KnowledgeStatus,
        expectedHash: z.string().min(1).max(128),
      })
      .strict(),
  ),
  /** Issue #1039: a new library document from a template, in the project's folder for its kind; never overwrites. */
  cmd(
    "knowledge.create",
    z
      .object({
        path: z.string().min(1).max(4096),
        kind: KnowledgeKind,
        title: z.string().min(1).max(200),
        /** The text under the heading instead of the template's sections (an assistant's draft, edited). */
        body: z.string().max(KNOWLEDGE_BODY_MAX).optional(),
      })
      .strict(),
  ),
  /** Issue #76: switch the index on or off for the project at `path`, in the host's config. */
  cmd(
    "knowledge.setFeed",
    z.object({ path: z.string().min(1).max(4096), enabled: z.boolean() }).strict(),
  ),
] as const;

/** The `data` of each agentSetup command's ack; `CommandResults` extends it. */
export interface AgentSetupResults {
  "harness.templates.list": { templates: HarnessTemplateInfo[] };
  "harness.templates.delete": { id: string };
  "mcp.list": { servers: McpServerView[] };
  "mcp.test":
    | { preview: { command?: string; args?: string[]; url?: string } }
    | { tools: string[]; resources: string[] };
  "mcp.save": { servers: McpServerView[] };
  "mcp.remove": { servers: McpServerView[] };
  "mcp.toggle": { servers: McpServerView[] };
  "mcp.status": { servers: McpLiveStatus[] };
  "agentcfg.list": { items: AgentCfgItem[] };
  "plugins.list": PluginList;
  "plugins.detail": InstalledPlugin;
  "plugins.preview": PluginPreview;
  "plugins.previewUpdate": PluginUpdatePreview;
  "plugins.install": PluginChange;
  "plugins.update": PluginChange;
  "plugins.uninstall": PluginChange;
  "plugins.pin": InstalledPlugin;
  "plugins.marketplaceAdd": PluginChange;
  "plugins.marketplaceRemove": PluginChange;
  "plugins.marketplaceUpdate": PluginChange;
  "memory.list": MemoryListing;
  "memory.read": MemoryFile & { content: string };
  "memory.write": { hash: string };
  "memory.delete": { name: string };
  "memory.budget": ContextBudget;
  "memory.suggest": { suggestions: MemorySuggestion[] };
  "agentcfg.read": AgentCfgItem & { content: string };
  "agentcfg.write": { hash: string };
  "template.list": TemplateListResult;
  "task.results": TaskResultsResult;
  "task.preview": TaskPreviewResult;
  "template.start": TemplateStartResult;
  "knowledge.list": KnowledgeListResult;
  "knowledge.index": KnowledgeIndexResult;
  "knowledge.feed": KnowledgeFeedState;
  "knowledge.setStatus": KnowledgeEntry;
  "knowledge.create": KnowledgeEntry;
  "knowledge.setFeed": KnowledgeFeedState;
}
