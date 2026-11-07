import { describe, expect, test } from "bun:test";
import type { AssistantContextBundle, AssistantResult } from "@flightdeck/protocol";
import { AssistantController } from "../src/lib/assistant.ts";
import type { AssistantPrefs } from "../src/lib/assistant-prefs.ts";
import { fakeAssistant } from "./fixtures.ts";

/**
 * Issue #162: a commit or PR message is written from the card's repo. The host provider reads the
 * repo itself (`source` on assistant.run); an API provider asks the card's host for the bundle
 * (`assistant.context`), which the daemon scans for secrets before it answers.
 */
const RESULT: AssistantResult = {
  text: "feat(app): add the login",
  model: "claude-sonnet-5-5",
  provider: "host",
  usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
  stopReason: "end_turn",
  notices: [],
};

const BUNDLE: AssistantContextBundle = {
  stat: " src/login.ts | 12 ++++",
  diff: "+export function login() {}",
  notShown: ["bun.lock"],
  redactedLines: 0,
  truncated: false,
  rules: "Use Conventional Commits.",
  recent: ["feat(app): add the menu"],
  conventional: true,
};

const SOURCE = { kind: "card" as const, cardId: "c1" };

function setup(
  options: {
    prefs?: Partial<AssistantPrefs>;
    hosts?: Array<{ id: string; online: boolean; assistant: boolean }>;
    context?: unknown;
    /** What the API provider answers; the commit message of `RESULT` by default. */
    answer?: string;
  } = {},
) {
  const sent: Array<[string, string, unknown]> = [];
  /** The texts the shell's vault check read. */
  const checked: string[] = [];
  const fake = fakeAssistant({
    run: () => ({ ...RESULT, provider: "anthropic", text: options.answer ?? RESULT.text }),
    vaultHits: (text) => {
      checked.push(text);
      return [];
    },
  });
  const items = new Map<string, string>();
  const controller = new AssistantController({
    storage: { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v) },
    api: fake.assistant,
    hosts: () => options.hosts ?? [{ id: "h1", online: true, assistant: true }],
    secrets: () => [{ id: "s1", name: "deploy key" }],
    language: () => "en",
    request: async (hostId, type, payload) => {
      sent.push([hostId, type, payload]);
      if (type === "assistant.context") {
        return (options.context ?? { ok: true, data: BUNDLE }) as never;
      }
      return { ok: true, data: RESULT } as never;
    },
  });
  controller.setPrefs({ confirmedHosts: ["h1", "h2"], ...options.prefs });
  return { controller, sent, fake, checked };
}

const refusal = (run: () => Promise<unknown>) =>
  run().then(
    () => null,
    (e: { reason?: string }) => e.reason ?? "no reason",
  );

describe("assistant-repo-source: a message is written from the card's repo (#162)", () => {
  test("the host provider sends the card as the source of assistant.run", async () => {
    const { controller, sent } = setup();
    await controller.run({
      requestId: "r1",
      kind: "commit.message",
      text: "",
      fieldHostId: "h1",
      source: SOURCE,
    });
    const payload = sent.find(([, type]) => type === "assistant.run")?.[2] as
      | { source?: unknown }
      | undefined;
    expect(payload?.source ?? "no source").toEqual(SOURCE);
  });

  test("an API provider asks the card's host for the scanned bundle and writes from its diff, rules and history", async () => {
    const { controller, sent, fake, checked } = setup({ prefs: { provider: "anthropic" } });
    await fake.assistant.setKey("anthropic", "sk-ant-aaaabbbb");
    await controller.refreshKeys();
    await controller.run({
      requestId: "r1",
      kind: "pr.title",
      text: "",
      fieldHostId: "h1",
      source: SOURCE,
    });
    const user = (fake.calls.find((c) => c[0] === "run")?.[1] as { user?: string } | undefined)
      ?.user;
    expect([
      sent,
      user?.includes(BUNDLE.diff) ?? false,
      user?.includes("<rules>") ?? false,
      user?.includes(BUNDLE.recent[0] as string) ?? false,
      checked.join("\n").includes(BUNDLE.diff),
    ]).toEqual([
      [["h1", "assistant.context", { kind: "pr", source: SOURCE }]],
      true,
      true,
      true,
      true,
    ]);
  });

  test("a secret the daemon finds in the repo refuses the call before anything reaches the provider", async () => {
    const { controller, fake } = setup({
      prefs: { provider: "anthropic" },
      context: {
        ok: false,
        code: "invalid_input",
        message: "secret",
        reason: "assistant_secret_found",
        params: { labels: "AWS key" },
      },
    });
    await fake.assistant.setKey("anthropic", "sk-ant-aaaabbbb");
    await controller.refreshKeys();
    const reason = await refusal(() =>
      controller.run({
        requestId: "r1",
        kind: "commit.message",
        text: "",
        fieldHostId: "h1",
        source: SOURCE,
      }),
    );
    expect([reason, fake.calls.some((c) => c[0] === "run")]).toEqual([
      "assistant_secret_found",
      false,
    ]);
  });

  test("a host provider that is not the card's host cannot read its repo: the call is refused", async () => {
    const { controller, sent } = setup({
      prefs: { provider: "host", hostId: "h2" },
      hosts: [
        { id: "h1", online: true, assistant: false },
        { id: "h2", online: true, assistant: true },
      ],
    });
    const reason = await refusal(() =>
      controller.run({
        requestId: "r1",
        kind: "commit.message",
        text: "",
        fieldHostId: "h1",
        source: SOURCE,
      }),
    );
    expect([reason, sent]).toEqual(["assistant_repo_other_host", []]);
  });
});

describe("assistant-repo-source: what the person is told about the message (#681)", () => {
  /** A commit message written by an API provider from the card's repo. */
  async function written(options: Parameters<typeof setup>[0] = {}) {
    const ready = setup({ prefs: { provider: "anthropic" }, ...options });
    await ready.fake.assistant.setKey("anthropic", "sk-ant-aaaabbbb");
    await ready.controller.refreshKeys();
    const result = await ready.controller.run({
      requestId: "r1",
      kind: "commit.message",
      text: "",
      fieldHostId: "h1",
      source: SOURCE,
    });
    return { ...ready, result };
  }

  test("an API provider's message is checked against the repo's rules, as the host's is", async () => {
    const { result } = await written({ answer: "Added the login." });
    expect(result.notices).toEqual(["subject_trailing_period", "subject_not_conventional"]);
  });

  test("a message that follows the rules has no notice", async () => {
    const { result } = await written();
    expect(result.notices).toEqual([]);
  });

  test("the person is told that the diff was cut and that lines were left out", async () => {
    const { result } = await written({
      context: { ok: true, data: { ...BUNDLE, truncated: true, redactedLines: 3 } },
    });
    expect(result.notices).toEqual(["diff_truncated", "lines_redacted"]);
  });

  test("a call that names no host is refused before any request is made", async () => {
    const { controller, sent, fake } = setup({ prefs: { provider: "anthropic" } });
    await fake.assistant.setKey("anthropic", "sk-ant-aaaabbbb");
    await controller.refreshKeys();
    const reason = await refusal(() =>
      controller.run({ requestId: "r1", kind: "commit.message", text: "", source: SOURCE }),
    );
    expect([reason, sent]).toEqual(["assistant_not_configured", []]);
  });
});
