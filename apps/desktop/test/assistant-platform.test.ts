import { describe, expect, test } from "bun:test";
import type { AssistantRequest, AssistantResult } from "@flightdeck/protocol";
import { tauriPlatform } from "../src/platform/tauri/index.ts";
import { fakeAssistant, memoryPlatform } from "./fixtures.ts";

const REQUEST: AssistantRequest = {
  requestId: "r1",
  kind: "card.title",
  system: "s",
  user: "u",
  model: "claude-haiku-5-5",
  maxTokens: 60,
  language: "en",
};
const RESULT: AssistantResult = {
  text: "Fix the total",
  model: "claude-haiku-5-5",
  provider: "anthropic",
  usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
  stopReason: "end_turn",
  notices: [],
};

/** A desktop platform whose `invoke` records the command and answers from `answers`. */
function desktop(answers: Record<string, unknown> = {}) {
  const sent: Array<[string, unknown]> = [];
  const call = (async (cmd: string, args?: unknown) => {
    sent.push([cmd, args]);
    const answer = answers[cmd];
    if (answer instanceof Error) throw answer;
    return answer;
  }) as never;
  return { platform: tauriPlatform({} as never, call), sent };
}

describe("assistant-platform: the desktop shell holds the keys and runs the API providers", () => {
  test("each call sends the exact command and arguments, and gives back only what Rust returned", async () => {
    const { platform, sent } = desktop({
      assistant_key_set: { last4: "a1b2" },
      assistant_key_status: { saved: true, last4: "a1b2" },
      assistant_test: { ok: true, limitRemaining: 4.5, isFreeTier: false },
      assistant_models: [{ id: "claude-haiku-5-5", label: "Haiku 5.5" }],
      assistant_run: RESULT,
      vault_hits: ["v1"],
    });
    const a = platform.assistant;
    expect(a.supported).toBe(true);
    expect(await a.setKey("anthropic", "sk-ant-secret")).toEqual({ last4: "a1b2" });
    expect(await a.keyStatus("anthropic")).toEqual({ saved: true, last4: "a1b2" });
    await a.deleteKey("openrouter");
    expect(await a.test("openrouter")).toEqual({
      ok: true,
      limitRemaining: 4.5,
      isFreeTier: false,
    });
    expect(await a.models("anthropic")).toEqual([{ id: "claude-haiku-5-5", label: "Haiku 5.5" }]);
    expect(await a.run(REQUEST, ["v1", "v2"])).toEqual(RESULT);
    await a.cancel("r1");
    expect(await a.vaultHits("text", ["v1", "v2"])).toEqual(["v1"]);
    expect(sent).toEqual([
      ["assistant_key_set", { provider: "anthropic", key: "sk-ant-secret" }],
      ["assistant_key_status", { provider: "anthropic" }],
      ["assistant_key_delete", { provider: "openrouter" }],
      ["assistant_test", { provider: "openrouter" }],
      ["assistant_models", { provider: "anthropic" }],
      ["assistant_run", { request: REQUEST, vaultIds: ["v1", "v2"] }],
      ["assistant_cancel", { requestId: "r1" }],
      ["vault_hits", { text: "text", ids: ["v1", "v2"] }],
    ]);
  });

  test("a refusal of the shell reaches the caller as it came: a reason and its params", async () => {
    const refusal = { reason: "assistant_credits", params: {} };
    const { platform } = desktop({ assistant_run: Object.assign(new Error("x"), refusal) });
    const error = await platform.assistant.run(REQUEST, []).catch((e: unknown) => e);
    expect((error as { reason?: string }).reason).toBe("assistant_credits");
  });

  test("there is no way to read a key back", () => {
    const { platform } = desktop();
    expect(Object.keys(platform.assistant).sort()).toEqual([
      "cancel",
      "deleteKey",
      "keyStatus",
      "models",
      "run",
      "setKey",
      "supported",
      "test",
      "vaultHits",
    ]);
  });
});

describe("assistant-platform: the web build offers no API provider", () => {
  test("it is not supported, holds no key and refuses to run", async () => {
    const a = memoryPlatform().platform.assistant;
    expect(a.supported).toBe(false);
    expect(await a.keyStatus("anthropic")).toEqual({ saved: false });
    expect(await a.models("openrouter")).toEqual([]);
    expect(await a.vaultHits("text", ["v1"])).toEqual([]);
    const refused = (run: () => Promise<unknown>) =>
      run().then(
        () => null,
        (e: { reason?: string }) => e.reason,
      );
    expect(await refused(() => a.setKey("anthropic", "k"))).toBe("assistant_not_configured");
    expect(await refused(() => a.run(REQUEST, []))).toBe("assistant_not_configured");
    expect(await refused(() => a.test("anthropic"))).toBe("assistant_not_configured");
  });
});

describe("assistant-platform: the fake the tests use logs its calls and never sees a key twice", () => {
  test("it records calls, keeps the last four characters only and answers what it is told", async () => {
    const fake = fakeAssistant({ run: () => RESULT });
    await fake.assistant.setKey("anthropic", "sk-ant-0123456789abcd");
    expect(await fake.assistant.keyStatus("anthropic")).toEqual({ saved: true, last4: "abcd" });
    expect(await fake.assistant.run(REQUEST, [])).toEqual(RESULT);
    expect(fake.calls.map((c) => c[0])).toEqual(["setKey", "keyStatus", "run"]);
    expect(JSON.stringify(fake.calls.slice(1))).not.toContain("sk-ant-0123456789abcd");
    await fake.assistant.deleteKey("anthropic");
    expect(await fake.assistant.keyStatus("anthropic")).toEqual({ saved: false });
  });
});
