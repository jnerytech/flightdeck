import type { Key, T } from "@/i18n/index";
import type { AssistantFailure } from "@/lib/assistant";

/** A refusal in words: the text of its reason, with the values it carries. Never a key, never the user's text. */
export function refusalText(t: T, failure: AssistantFailure): string {
  const params = { ...failure.params };
  if (failure.reason === "assistant_key_invalid") {
    params.why = t(`assistantSettings.keyWhy.${String(params.why ?? "empty")}` as Key);
  }
  return t(`assistantRefusal.${failure.reason}` as Key, params);
}

/** What a rejection carries: the reason and params of the shell, or "cannot be reached" for anything else. */
export function failureOf(error: unknown): AssistantFailure {
  const shape = error as { reason?: unknown; params?: unknown } | null;
  if (shape && typeof shape.reason === "string") {
    return {
      reason: shape.reason,
      ...(shape.params ? { params: shape.params as AssistantFailure["params"] } : {}),
    } as AssistantFailure;
  }
  return { reason: "assistant_offline" };
}
