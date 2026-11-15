// The Agent setup context, the project harness: its stack, preview, applied files, templates, draft and commit (issue #1589: moved from agent-setup.ts).
import { z } from "zod";

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
