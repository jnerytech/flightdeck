// Phase 18: the snippets as they cross the wire: what the daemon keeps and the commands. The model
// (how a snippet is checked and filled in) lives in snippet-model.ts, re-exported here with the
// secret scanner, so `snippets.ts` stays the one public entry (issue #1589).

import { z } from "zod";
import { cmd } from "./command.ts";
import { SnippetField, SnippetInput, SnippetVar } from "./snippet-model.ts";
import { TerminalCols, type TerminalInfo, TerminalRows } from "./terminal.ts";

export * from "./secret-scanner.ts";
export * from "./snippet-model.ts";

export const SnippetScope = z.enum(["host", "project"]);

/** A snippet of this host, from the daemon or from a project's versioned file. */
export const Snippet = z.object({
  /** A ULID for the ones in the daemon; `file:<project>:<name>` for the ones in the file. */
  id: z.string(),
  scope: SnippetScope,
  source: z.enum(["daemon", "file"]),
  projectPath: z.string().nullable(),
  name: z.string(),
  type: z.enum(["command", "prompt"]),
  run: z.string().nullable(),
  text: z.string().nullable(),
  vars: z.record(z.string(), SnippetVar),
  tags: z.array(z.string()),
  fields: z.array(SnippetField),
  favorite: z.boolean(),
  uses: z.number().int(),
  lastUsedAt: z.string().nullable(),
  /** A command from the versioned file runs only when the file is trusted; pasting never needs it. */
  runnable: z.boolean(),
});
export type Snippet = z.infer<typeof Snippet>;

/** The project's versioned `.flightdeck/snippets.yaml`: its hash, whether it is trusted and what was left out. */
export const SnippetFileInfo = z.object({
  path: z.string(),
  hash: z.string(),
  trusted: z.boolean(),
  errors: z.array(z.string()),
});
export type SnippetFileInfo = z.infer<typeof SnippetFileInfo>;

/** A line of the shell history that could become a snippet; a flagged one has no `command` until revealed and is never `selectable`. */
export const SnippetHistoryCandidate = z.object({
  /** Stable for the same command, so the app can say which ones to import. */
  id: z.string(),
  command: z.string().nullable(),
  count: z.number().int(),
  shells: z.array(z.string()),
  /** What the secret scan found (the kinds, never the values). */
  flagged: z.array(z.string()),
  hidden: z.boolean(),
  selectable: z.boolean(),
});
export type SnippetHistoryCandidate = z.infer<typeof SnippetHistoryCandidate>;

export const SnippetHistoryResult = z.object({
  candidates: z.array(SnippetHistoryCandidate),
  sources: z.array(z.object({ shell: z.string(), found: z.boolean() })),
  created: z.array(Snippet),
  skipped: z.array(z.object({ id: z.string(), reason: z.string() })),
});
export type SnippetHistoryResult = z.infer<typeof SnippetHistoryResult>;

const SnippetValues = z.record(z.string().max(100), z.string().max(4000));

const SnippetUseContext = z
  .object({
    cwd: z.string().optional(),
    file: z.string().max(4000).optional(),
    selection: z.string().max(20_000).optional(),
  })
  .strict();

/** The snippets commands; index.ts spreads them into `Command`. */
export const snippetsCommands = [
  /** Snippets of the host and, with `projectPath`, of that project, favorites and recents first. */
  cmd(
    "snippets.list",
    z
      .object({
        scope: z.enum(["host", "project", "all"]).optional(),
        projectPath: z.string().optional(),
        query: z.string().optional(),
        tag: z.string().optional(),
        type: z.enum(["command", "prompt"]).optional(),
      })
      .strict(),
  ),
  /** Creates (no `id`) or edits a snippet; a secret in it is refused with `snippet_secret`. */
  cmd(
    "snippets.save",
    z
      .object({
        ...SnippetInput.shape,
        id: z.string().optional(),
        scope: SnippetScope,
        target: z.enum(["daemon", "file"]).optional(),
        projectPath: z.string().optional(),
      })
      .strict(),
  ),
  /** By `id`, or by `name` (the host's, then the `projectPath`'s). */
  cmd(
    "snippets.get",
    z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
        projectPath: z.string().optional(),
      })
      .strict()
      .refine((p) => p.id !== undefined || p.name !== undefined, { message: "give id or name" }),
  ),
  cmd("snippets.remove", z.object({ id: z.string() }).strict()),
  /** Trusts the content of the project's versioned file, by the hash `snippets.list` showed. */
  cmd("snippets.trust", z.object({ projectPath: z.string(), hash: z.string() }).strict()),
  cmd("snippets.favorite", z.object({ id: z.string(), favorite: z.boolean() }).strict()),
  /** Reads a YAML or JSON list of snippets (an import from a file); saves nothing. */
  cmd("snippets.parse", z.object({ text: z.string().max(1_000_000) }).strict()),
  /**
   * The most used commands of this host's shell histories (read only, secrets hidden). With
   * `select` (ids of the candidates) it also makes them snippets of the host.
   */
  cmd(
    "snippets.importHistory",
    z
      .object({
        limit: z.number().int().min(1).max(200).optional(),
        reveal: z.boolean().optional(),
        select: z.array(z.string()).max(200).optional(),
      })
      .strict(),
  ),
  /** The text a snippet would produce with these values and context, and the fields it asks for. */
  cmd(
    "snippets.render",
    z
      .object({
        id: z.string(),
        values: SnippetValues.optional(),
        context: SnippetUseContext.optional(),
      })
      .strict(),
  ),
  /**
   * Uses a snippet: `paste` types a command into a terminal (`enter` also runs it), `run` opens a
   * new tab at `context.cwd`, `send` sends a prompt to a session (`sessionId` or `claudeSessionId`).
   */
  cmd(
    "snippets.use",
    z
      .object({
        id: z.string(),
        action: z.enum(["paste", "run", "send"]),
        values: SnippetValues.optional(),
        context: SnippetUseContext.optional(),
        terminalId: z.string().optional(),
        enter: z.boolean().optional(),
        cols: TerminalCols.optional(),
        rows: TerminalRows.optional(),
        sessionId: z.string().optional(),
        claudeSessionId: z.string().optional(),
      })
      .strict(),
  ),
] as const;

/** The `data` of each snippets command's ack; `CommandResults` extends it. */
export interface SnippetsResults {
  "snippets.list": { snippets: Snippet[]; file: SnippetFileInfo | null };
  "snippets.save": Snippet;
  "snippets.get": Snippet;
  "snippets.remove": undefined;
  "snippets.trust": SnippetFileInfo;
  "snippets.favorite": Snippet;
  "snippets.parse": { snippets: SnippetInput[]; errors: string[] };
  "snippets.importHistory": SnippetHistoryResult;
  "snippets.render": { text: string; fields: SnippetField[] };
  "snippets.use": { text: string; terminal: TerminalInfo | null };
}
