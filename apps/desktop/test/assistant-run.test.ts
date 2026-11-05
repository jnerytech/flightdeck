import { describe, expect, test } from "bun:test";
import {
  ASSISTANT_MAX_INPUT,
  type AssistantResult,
  type AssistantRunPayload,
  KIND_SPECS,
} from "@flightdeck/protocol";
import { AssistantController, type AssistantControllerDeps } from "../src/lib/assistant.ts";
import { type AssistantPrefs, defaultPrefs } from "../src/lib/assistant-prefs.ts";
import { fakeAssistant } from "./fixtures.ts";

const RESULT: AssistantResult = {
  text: "Fix the total",
  model: "claude-haiku-5-5",
  provider: "host",
  usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
  stopReason: "end_turn",
  notices: [],
};

function setup(
  options: {
    prefs?: Partial<AssistantPrefs>;
    hosts?: Array<{ id: string; online: boolean; assistant: boolean }>;
    supported?: boolean;
    secrets?: Array<{ id: string; name: string }>;
    answer?: (type: string, payload: unknown) => unknown;
    api?: Parameters<typeof fakeAssistant>[0];
  } = {},
) {
  const items = new Map<string, string>();
  const sent: Array<[string, string, unknown]> = [];
  const fake = fakeAssistant({ supported: options.supported ?? true, ...options.api });
  const deps: AssistantControllerDeps = {
    storage: {
      getItem: (k) => items.get(k) ?? null,
      setItem: (k, v) => void items.set(k, v),
    },
    api: fake.assistant,
    hosts: () => options.hosts ?? [{ id: "h1", online: true, assistant: true }],
    secrets: () => options.secrets ?? [],
    language: () => "en",
    request: async (hostId, type, payload) => {
      sent.push([hostId, type, payload]);
      const answer = options.answer ? options.answer(type, payload) : RESULT;
      return answer instanceof Error || (answer as { ok?: boolean })?.ok === false
        ? (answer as never)
        : ({ ok: true, data: answer } as never);
    },
  };
  const controller = new AssistantController(deps);
  controller.setPrefs({ ...options.prefs });
  return { controller, sent, fake, items };
}
const input = (over: Record<string, unknown> = {}) => ({
  requestId: "r1",
  kind: "card.title" as const,
  text: "fix the totl",
  ...over,
});
const refusal = (run: () => Promise<unknown>) =>
  run().then(
    () => null,
    (e: { reason?: string; params?: Record<string, unknown> }) => ({
      reason: e.reason,
      params: e.params,
    }),
  );

describe("assistant-run: a wand's request goes to the provider the person chose", () => {
  test("the host provider sends assistant.run to the field's host with the kind's profile and the model for it", async () => {
    const { controller, sent } = setup({ hosts: [{ id: "h1", online: true, assistant: true }] });
    const result = await controller.run(
      input({ context: { description: "d" }, fieldHostId: "h1", cwd: "/work/app" }),
    );
    expect(result).toEqual(RESULT);
    expect(sent).toEqual([
      [
        "h1",
        "assistant.run",
        {
          requestId: "r1",
          kind: "card.title",
          text: "fix the totl",
          context: { description: "d" },
          language: "en",
          profile: KIND_SPECS["card.title"].profile,
          model: "claude-haiku-5-5",
          cwd: "/work/app",
        } satisfies AssistantRunPayload,
      ],
    ]);
  });

  test("the chosen profile and model of the kind are used", async () => {
    const { controller, sent } = setup({
      prefs: {
        profiles: { "card.title": "careful" },
        models: { host: { careful: "claude-opus-5-5" } },
      },
    });
    await controller.run(input());
    expect(sent[0]?.[2]).toMatchObject({ profile: "careful", model: "claude-opus-5-5" });
  });

  test("an API provider builds the request with the shared prompt, checks the vault in the shell and normalizes the answer", async () => {
    const { controller, fake, sent } = setup({
      prefs: { provider: "anthropic" },
      secrets: [{ id: "s1", name: "deploy key" }],
      api: {
        run: () => ({ ...RESULT, provider: "anthropic", text: '```\n"Fix the total"\n```' }),
      },
    });
    await fake.assistant.setKey("anthropic", "sk-ant-aaaabbbb");
    await controller.refreshKeys();
    const result = await controller.run(input());
    expect(sent).toEqual([]);
    const call = fake.calls.find((c) => c[0] === "run");
    const request = call?.[1] as { kind: string; model: string; user: string; maxTokens: number };
    expect(request).toMatchObject({
      kind: "card.title",
      model: "claude-haiku-5-5",
      maxTokens: KIND_SPECS["card.title"].maxTokens,
    });
    expect(request.user).toContain("fix the totl");
    expect(call?.[2]).toEqual(["s1"]);
    expect(fake.calls.map((c) => c[0])).toContain("vaultHits");
    expect(result.text).toBe("Fix the total");
  });

  test("no provider refuses with assistant_not_configured and calls nothing", async () => {
    const { controller, sent, fake } = setup({ hosts: [] });
    expect(await refusal(() => controller.run(input()))).toEqual({
      reason: "assistant_not_configured",
      params: undefined,
    });
    expect(sent).toEqual([]);
    expect(fake.calls.filter((c) => c[0] === "run")).toEqual([]);
  });
});

describe("assistant-run: nothing is sent when the text holds a secret", () => {
  test("a token shape in the text refuses with its kind, not its value, before any call", async () => {
    const { controller, sent, fake } = setup();
    const error = await refusal(() =>
      controller.run(input({ text: "use password=hunter2secret to log in" })),
    );
    expect(error?.reason).toBe("assistant_secret_found");
    expect(JSON.stringify(error)).not.toContain("hunter2secret");
    expect(sent).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  test("a vault value found by the shell refuses with the names of the entries, on the API path", async () => {
    const { controller, fake } = setup({
      prefs: { provider: "anthropic" },
      secrets: [
        { id: "s1", name: "deploy key" },
        { id: "s2", name: "other" },
      ],
      api: { vaultHits: () => ["s1"] },
    });
    await fake.assistant.setKey("anthropic", "sk-ant-aaaabbbb");
    await controller.refreshKeys();
    const error = await refusal(() => controller.run(input({ text: "the value is in here" })));
    expect(error).toEqual({ reason: "assistant_vault_value", params: { names: "deploy key" } });
    expect(fake.calls.filter((c) => c[0] === "run")).toEqual([]);
  });

  test("an empty text is refused where the kind cannot write from nothing, and a text over the limit always", async () => {
    const { controller } = setup();
    expect(
      (await refusal(() => controller.run(input({ kind: "prompt", text: "  " }))))?.reason,
    ).toBe("assistant_empty_input");
    const long = "x".repeat(ASSISTANT_MAX_INPUT + 1);
    expect(await refusal(() => controller.run(input({ text: long })))).toEqual({
      reason: "assistant_too_long",
      params: { max: ASSISTANT_MAX_INPUT },
    });
  });
});

describe("assistant-run: failures arrive as a reason the screen can translate", () => {
  test("a refusal of the host keeps its reason and params; one without a reason is the host being unavailable", async () => {
    const withReason = setup({
      answer: () => ({
        ok: false,
        code: "invalid_state",
        message: "x",
        reason: "assistant_quota_blocked",
        params: { until: "5pm" },
      }),
    });
    expect(await refusal(() => withReason.controller.run(input()))).toEqual({
      reason: "assistant_quota_blocked",
      params: { until: "5pm" },
    });
    const without = setup({
      answer: () => ({ ok: false, code: "offline", message: "unknown host" }),
    });
    expect((await refusal(() => without.controller.run(input())))?.reason).toBe(
      "assistant_host_unavailable",
    );
  });

  test("a rejection of the shell keeps its reason; anything else is the provider being unreachable", async () => {
    const shell = setup({
      prefs: { provider: "openrouter" },
      api: {
        run: () => Promise.reject({ reason: "assistant_credits", params: {} }),
      },
    });
    await shell.fake.assistant.setKey("openrouter", "sk-or-aaaabbbb");
    await shell.controller.refreshKeys();
    expect((await refusal(() => shell.controller.run(input())))?.reason).toBe("assistant_credits");
    const odd = setup({
      prefs: { provider: "openrouter" },
      api: { run: () => Promise.reject(new Error("socket hang up")) },
    });
    await odd.fake.assistant.setKey("openrouter", "sk-or-aaaabbbb");
    await odd.controller.refreshKeys();
    expect((await refusal(() => odd.controller.run(input())))?.reason).toBe("assistant_offline");
  });

  test("an answer that cannot be used (placeholders changed) is refused after the call", async () => {
    const { controller } = setup({
      answer: () => ({ ...RESULT, text: "Run {{other}}" }),
    });
    expect(
      (await refusal(() => controller.run(input({ kind: "snippet.prompt", text: "Run {{name}}" }))))
        ?.reason,
    ).toBe("assistant_placeholders_changed");
  });
});

describe("assistant-run: one call at a time, and a call can be cancelled", () => {
  test("a second run while one is on its way is refused, and the gate opens again when it ends, even in failure", async () => {
    let finish: (value: unknown) => void = () => {};
    const slow = new Promise((resolve) => {
      finish = resolve;
    });
    const { controller } = setup({ answer: () => slow });
    const first = controller.run(input());
    expect(controller.gate.busy()).toBe(true);
    expect((await refusal(() => controller.run(input({ requestId: "r2" }))))?.reason).toBe(
      "assistant_rate_limited",
    );
    finish(RESULT);
    await first;
    expect(controller.gate.busy()).toBe(false);
    const failing = setup({ answer: () => ({ ok: false, code: "x", message: "m" }) });
    await refusal(() => failing.controller.run(input()));
    expect(failing.controller.gate.busy()).toBe(false);
  });

  test("cancel tells the host or the shell by the request id", async () => {
    const host = setup();
    await host.controller.cancel("r1", { provider: "host", hostId: "h1" });
    expect(host.sent).toEqual([["h1", "assistant.cancel", { requestId: "r1" }]]);
    const api = setup({ prefs: { provider: "anthropic" } });
    await api.controller.cancel("r2", { provider: "anthropic" });
    expect(api.fake.calls).toEqual([["cancel", "r2"]]);
  });
});

describe("assistant-run: the preferences and the keys", () => {
  test("setPrefs merges, keeps the shape and tells the listeners; keys read as present or not", async () => {
    const { controller, fake, items } = setup();
    const seen: number[] = [];
    controller.subscribe(() => void seen.push(1));
    controller.setPrefs({ enabled: false });
    expect(controller.prefs()).toEqual({ ...defaultPrefs(), enabled: false });
    expect(JSON.parse(items.get("flightdeck.assistant") ?? "{}").enabled).toBe(false);
    expect(seen.length).toBeGreaterThan(0);
    expect(controller.keys()).toEqual({ anthropic: false, openrouter: false });
    await fake.assistant.setKey("openrouter", "sk-or-aaaabbbb");
    await controller.refreshKeys();
    expect(controller.keys()).toEqual({ anthropic: false, openrouter: true });
  });

  test("the web build is never asked for a key", async () => {
    const { controller, fake } = setup({ supported: false });
    await controller.refreshKeys();
    expect(fake.calls).toEqual([]);
    expect(controller.keys()).toEqual({ anthropic: false, openrouter: false });
  });
});

describe("assistant-run: the key calls the Settings screen makes", () => {
  test("saving and removing a key keep the key state in step, and nothing logs the key itself", async () => {
    const { controller, fake } = setup();
    expect(await controller.saveKey("anthropic", "sk-ant-0123wxyz")).toEqual({ last4: "wxyz" });
    expect(controller.keys()).toEqual({ anthropic: true, openrouter: false });
    expect(await controller.keyStatus("anthropic")).toEqual({ saved: true, last4: "wxyz" });
    await controller.removeKey("anthropic");
    expect(controller.keys()).toEqual({ anthropic: false, openrouter: false });
    expect(JSON.stringify(fake.calls)).not.toContain("sk-ant-0123wxyz");
  });

  test("test and models are the shell's answers as they are", async () => {
    const { controller } = setup({
      api: {
        test: async () => ({ ok: false, detail: "assistant_auth" }),
        models: () => [{ id: "claude-haiku-5-5", label: "Haiku 5.5" }],
      },
    });
    expect(await controller.testKey("openrouter")).toEqual({ ok: false, detail: "assistant_auth" });
    expect(await controller.models("anthropic")).toEqual([
      { id: "claude-haiku-5-5", label: "Haiku 5.5" },
    ]);
  });
});
