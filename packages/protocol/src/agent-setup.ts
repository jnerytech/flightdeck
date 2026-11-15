// The Agent setup context: what a session starts with, its MCP servers, agent files, memory, plugins, library, harness, task templates and context budget (issue #1600: moved from index.ts).
import { z } from "zod";
import { HARNESS_TEMPLATE_ID, type HarnessTemplateInfo } from "./agent-setup/harness.ts";
import {
  KNOWLEDGE_BODY_MAX,
  type KnowledgeEntry,
  type KnowledgeFeedState,
  type KnowledgeIndexResult,
  KnowledgeKind,
  type KnowledgeListResult,
  KnowledgeStatus,
} from "./agent-setup/knowledge.ts";
import type {
  InstalledPlugin,
  PluginChange,
  PluginList,
  PluginPreview,
  PluginUpdatePreview,
} from "./agent-setup/plugins.ts";
import type {
  TaskPreviewResult,
  TaskResultsResult,
  TemplateListResult,
  TemplateStartResult,
} from "./agent-setup/templates.ts";
import { cmd } from "./command.ts";
import { BudgetSource } from "./usage.ts";

// Each domain's schemas live in a file of their own; the public entry stays this file.
export * from "./agent-setup/harness.ts";
export * from "./agent-setup/knowledge.ts";
export * from "./agent-setup/plugins.ts";
export * from "./agent-setup/templates.ts";

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
