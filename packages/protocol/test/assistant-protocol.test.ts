import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ASSISTANT_FEATURE,
  ASSISTANT_REASONS,
  AssistantKind,
  AssistantProfile,
  AssistantProvider,
  AssistantRequest,
  AssistantResult,
  Command,
  UsageOrigin,
} from "../src/index.ts";

const command = (type: string, payload: unknown) => Command.safeParse({ id: "1", type, payload });
const accepted = (type: string, payload: unknown) => command(type, payload).success;

/** The keys of the `assistantRefusal` block of an app dictionary, read as text (no app import here). */
function refusalTexts(file: string): string[] {
  const source = readFileSync(
    resolve(import.meta.dir, "../../../apps/desktop/src/i18n", file),
    "utf8",
  );
  const start = source.indexOf("\n  assistantRefusal: {\n");
  if (start < 0) return [];
  const end = source.indexOf("\n  },\n", start);
  return [...source.slice(start, end).matchAll(/^ {4}(\w+):/gm)].map((m) => m[1] as string);
}

describe("assistant-protocol", () => {
  test("the providers, profiles and kinds are closed lists", () => {
    expect(AssistantProvider.options).toEqual(["host", "anthropic", "openrouter"]);
    expect(AssistantProfile.options).toEqual(["quick", "careful"]);
    expect(AssistantKind.options).toEqual([
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
    expect(UsageOrigin.options).toContain("assistant");
    expect(ASSISTANT_FEATURE).toBe("assistant");
  });

  test("a request an executor runs, and the result it gives back", () => {
    const request = {
      requestId: "01JAB",
      kind: "card.title",
      system: "s",
      user: "u",
      model: "claude-haiku-5-5",
      maxTokens: 60,
      language: "en",
    };
    expect(AssistantRequest.safeParse(request).success).toBe(true);
    expect(AssistantRequest.safeParse({ ...request, maxTokens: 4097 }).success).toBe(false);
    expect(AssistantRequest.safeParse({ ...request, model: "bad model" }).success).toBe(false);
    expect(AssistantRequest.safeParse({ ...request, kind: "snippet.command" }).success).toBe(false);
    const result = {
      text: "Fix the login bug",
      model: "claude-haiku-5-5",
      provider: "anthropic",
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
      stopReason: "end_turn",
      notices: [],
    };
    expect(AssistantResult.safeParse(result).success).toBe(true);
    expect(AssistantResult.safeParse({ ...result, costUsd: 0.001 }).success).toBe(true);
    expect(AssistantResult.safeParse({ ...result, provider: "openai" }).success).toBe(false);
  });

  test("the daemon's commands: run, cancel, context and record", () => {
    const run = {
      requestId: "r1",
      kind: "prompt",
      text: "fix it",
      language: "en",
      profile: "quick",
    };
    expect(accepted("assistant.run", run)).toBe(true);
    expect(
      accepted("assistant.run", {
        ...run,
        kind: "commit.message",
        text: "",
        source: { kind: "card", cardId: "c1" },
        context: { title: "x" },
        model: "claude-sonnet-5-5",
        cwd: "/w",
      }),
    ).toBe(true);
    expect(accepted("assistant.run", { ...run, text: "x".repeat(100_001) })).toBe(false);
    expect(accepted("assistant.run", { ...run, source: { kind: "branch", cwd: "/w" } })).toBe(
      false,
    );
    expect(accepted("assistant.cancel", { requestId: "r1" })).toBe(true);
    for (const source of [
      { kind: "card", cardId: "c1" },
      { kind: "worktree", cwd: "/w" },
      { kind: "staged", cwd: "/w" },
    ]) {
      expect(accepted("assistant.context", { kind: "commit", source })).toBe(true);
    }
    expect(
      accepted("assistant.context", { kind: "card.title", source: { kind: "staged", cwd: "/w" } }),
    ).toBe(false);
    const record = {
      id: "r1",
      at: "2026-11-05T10:00:00.000Z",
      provider: "openrouter",
      model: "anthropic/claude-haiku-5.5",
      tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0.0002,
    };
    expect(accepted("assistant.record", record)).toBe(true);
    expect(accepted("assistant.record", { ...record, provider: "unknown" })).toBe(false);
    expect(accepted("assistant.record", { ...record, costUsd: -1 })).toBe(false);
    expect(
      accepted("assistant.record", { ...record, tokens: { ...record.tokens, input: -1 } }),
    ).toBe(false);
  });

  test("card.mergeLocal takes a message and card.pr.create a title, both optional with limits", () => {
    expect(accepted("card.mergeLocal", { cardId: "c1" })).toBe(true);
    expect(accepted("card.mergeLocal", { cardId: "c1", message: "feat: x\n\nwhy" })).toBe(true);
    expect(accepted("card.mergeLocal", { cardId: "c1", message: "" })).toBe(false);
    expect(accepted("card.mergeLocal", { cardId: "c1", message: "x".repeat(5001) })).toBe(false);
    expect(accepted("card.mergeLocal", { cardId: "c1", message: "a\u0000b" })).toBe(false);
    expect(accepted("card.pr.create", { cardId: "c1" })).toBe(true);
    expect(accepted("card.pr.create", { cardId: "c1", title: "Fix the login bug" })).toBe(true);
    expect(accepted("card.pr.create", { cardId: "c1", title: "two\nlines" })).toBe(false);
    expect(accepted("card.pr.create", { cardId: "c1", title: "x".repeat(257) })).toBe(false);
    expect(accepted("card.pr.create", { cardId: "c1", title: "" })).toBe(false);
    const merged = command("card.mergeLocal", { cardId: "c1" });
    expect(
      merged.success && merged.data.type === "card.mergeLocal" ? merged.data.payload.mode : null,
    ).toBe("merge");
  });

  test("every refusal names its reason, and the app has a text for each in both languages", () => {
    expect([...ASSISTANT_REASONS]).toEqual([
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
    ]);
    const sorted = [...ASSISTANT_REASONS].sort();
    expect([refusalTexts("en.ts").sort(), refusalTexts("pt-BR.ts").sort()]).toEqual([
      sorted,
      sorted,
    ]);
  });
});
