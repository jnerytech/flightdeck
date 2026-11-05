/**
 * Phase 40: the AI assistant. The providers, the kinds of text it may touch, the request an executor
 * runs (the daemon's `claude` or the app's Rust shell) and what it gives back, the daemon's commands,
 * and the reasons a refusal can carry.
 */
import { z } from "zod";

/** The host feature that announces the assistant (`host.info.features`). */
export const ASSISTANT_FEATURE = "assistant";

export const AssistantProvider = z.enum(["host", "anthropic", "openrouter"]);
export type AssistantProvider = z.infer<typeof AssistantProvider>;

/** `quick` for fields, `careful` for commit and PR messages and persona instructions. */
export const AssistantProfile = z.enum(["quick", "careful"]);
export type AssistantProfile = z.infer<typeof AssistantProfile>;

/** The closed list of texts the assistant may touch: anything else has no wand (an allowlist). */
export const AssistantKind = z.enum([
  "prompt",
  "prompt.plain",
  "card.title",
  "card.description",
  "persona.description",
  "persona.instructions",
  "team.goal",
  "snippet.prompt",
  "commit.message",
  "pr.title",
  "pr.description",
]);
export type AssistantKind = z.infer<typeof AssistantKind>;

/** The longest text the assistant takes, in characters. */
export const ASSISTANT_MAX_INPUT = 100_000;
/** The largest answer it asks for, in tokens. */
export const ASSISTANT_MAX_TOKENS = 4096;
/** A model id as the providers write them (`claude-haiku-5-5`, `anthropic/claude-haiku-5.5`). */
export const ModelId = z.string().regex(/^[A-Za-z0-9._:/-]{1,100}$/);

/** What an executor runs: the prompt is already built (shared code), the executor only calls. */
export const AssistantRequest = z
  .object({
    requestId: z.string().min(1).max(64),
    kind: AssistantKind,
    system: z.string(),
    user: z.string().max(ASSISTANT_MAX_INPUT * 2),
    model: ModelId,
    maxTokens: z.number().int().min(1).max(ASSISTANT_MAX_TOKENS),
    language: z.string().min(2).max(16),
  })
  .strict();
export type AssistantRequest = z.infer<typeof AssistantRequest>;

const Count = z.number().int().nonnegative();

export const AssistantUsage = z.object({
  inputTokens: Count,
  outputTokens: Count,
  cacheReadTokens: Count,
  cacheWriteTokens: Count,
});
export type AssistantUsage = z.infer<typeof AssistantUsage>;

export const AssistantResult = z.object({
  text: z.string(),
  model: z.string(),
  provider: AssistantProvider,
  usage: AssistantUsage,
  /** What the provider billed, when it says (OpenRouter's `usage.cost`). */
  costUsd: z.number().nonnegative().optional(),
  stopReason: z.string(),
  /** Things the preview says beside the text (a commit subject over 72 characters, a truncated diff). */
  notices: z.array(z.string()),
});
export type AssistantResult = z.infer<typeof AssistantResult>;

/** Where a commit or PR message is written from; `cwd` is checked against the allowed roots. */
export const CommitSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("card"), cardId: z.string().min(1) }),
  z.object({ kind: z.literal("worktree"), cwd: z.string().min(1) }),
  z.object({ kind: z.literal("staged"), cwd: z.string().min(1) }),
]);
export type CommitSource = z.infer<typeof CommitSource>;

/** `assistant.run`: the daemon builds the request itself, reading the repo when `source` is given. */
export const AssistantRunPayload = z.object({
  requestId: z.string().min(1).max(64),
  kind: AssistantKind,
  text: z.string().max(ASSISTANT_MAX_INPUT),
  /** What the kind uses beside the text (a card's title, a snippet's variables). */
  context: z.record(z.string(), z.string().max(ASSISTANT_MAX_INPUT)).optional(),
  source: CommitSource.optional(),
  language: z.string().min(2).max(16),
  model: ModelId.optional(),
  profile: AssistantProfile,
  cwd: z.string().min(1).optional(),
});
export type AssistantRunPayload = z.infer<typeof AssistantRunPayload>;

export const AssistantCancelPayload = z.object({ requestId: z.string().min(1).max(64) });

/** `assistant.context`: the redacted bundle of a repo, for a provider the app calls itself. */
export const AssistantContextPayload = z.object({
  kind: z.enum(["commit", "pr"]),
  source: CommitSource,
});

/** What `assistant.context` gives: no author names, emails, hashes or file contents outside the diff. */
export interface AssistantContextBundle {
  stat: string;
  diff: string;
  /** Files listed but not shown (binary, lockfile, generated, credential, over the budget). */
  notShown: string[];
  redactedLines: number;
  truncated: boolean;
  /** The repo's own rules about commits and PRs. */
  rules: string;
  /** The last subjects of the repo's history. */
  recent: string[];
  /** At least half of `recent` follows Conventional Commits. */
  conventional: boolean;
}

/** `assistant.record`: the usage of a call the app made itself; idempotent by `id`. */
export const AssistantRecordPayload = z.object({
  id: z.string().min(1).max(64),
  at: z.string().datetime(),
  provider: AssistantProvider,
  model: ModelId,
  tokens: z.object({ input: Count, output: Count, cacheRead: Count, cacheWrite: Count }),
  costUsd: z.number().nonnegative().optional(),
  cwd: z.string().min(1).optional(),
});
export type AssistantRecordPayload = z.infer<typeof AssistantRecordPayload>;

/** Every reason an assistant refusal can carry, from the daemon or the app's shell. */
export const ASSISTANT_REASONS = [
  "assistant_not_configured",
  "assistant_empty_input",
  "assistant_too_long",
  "assistant_secret_found",
  "assistant_vault_value",
  "assistant_quota_blocked",
  "assistant_host_unavailable",
  "assistant_auth",
  "assistant_credits",
  "assistant_rate_limited",
  "assistant_overloaded",
  "assistant_routing_unavailable",
  "assistant_model_unavailable",
  "assistant_truncated",
  "assistant_refused",
  "assistant_bad_output",
  "assistant_placeholders_changed",
  "assistant_timeout",
  "assistant_cancelled",
  "assistant_offline",
  "assistant_no_changes",
  "assistant_not_a_repo",
  "assistant_request_id",
  /** A key the shell refused to store; `params.why` says how (empty, control, whitespace, length, provider). */
  "assistant_key_invalid",
] as const;
export type AssistantReason = (typeof ASSISTANT_REASONS)[number];

/** A model a provider offers, as the pickers list it (the list comes from the provider through the shell). */
export const ModelOption = z.object({
  id: ModelId,
  label: z.string().min(1),
  /** Anthropic: the model line; OpenRouter: the vendor before the slash. */
  group: z.string().min(1).optional(),
  /** USD per million tokens (OpenRouter only). */
  promptPerMTok: z.number().nonnegative().optional(),
  completionPerMTok: z.number().nonnegative().optional(),
  /** The model takes an `effort` setting. */
  supportsEffort: z.boolean().optional(),
});
export type ModelOption = z.infer<typeof ModelOption>;
