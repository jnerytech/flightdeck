// The Agent setup context, plugins: what one installs, what changed and the marketplaces (issue #1589: moved from agent-setup.ts).
import { z } from "zod";

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
