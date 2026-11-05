import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  type AssistantContextBundle,
  type AssistantRunPayload,
  SecretScanner,
} from "@flightdeck/protocol";
import { assistantDir } from "../src/assistant/paths.ts";
import { AssistantService } from "../src/assistant/service.ts";
import { FlightdeckError } from "../src/errors.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import type { CompleteOptions, CompleteResult } from "../src/runtime/types.ts";

/** A clock the test moves by hand. */
function clock() {
  let now = 0;
  let next = 1;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    timers: {
      set: (fn: () => void, ms: number) => {
        const id = next++;
        due.set(id, { at: now + ms, fn });
        return id;
      },
      clear: (id: unknown) => {
        due.delete(id as number);
      },
    },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...due].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) {
          due.delete(id);
          t.fn();
        }
      }
    },
    now: () => now,
  };
}

const TOKENS = {
  model: "claude-haiku-5-5",
  speed: "standard",
  input: 100,
  output: 20,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
};

/** A runtime whose answers the test releases, and which gives up when its signal aborts. */
function heldRuntime() {
  const pending: Array<{ opts: CompleteOptions; answer: (text: string) => void }> = [];
  const runtime = new FakeRuntime({
    complete: (opts) =>
      new Promise<CompleteResult>((resolve, reject) => {
        pending.push({
          opts,
          answer: (text) => resolve({ text, subtype: "success", tokens: TOKENS }),
        });
        opts.signal?.addEventListener("abort", () =>
          reject(new FlightdeckError("invalid_state", "cancelled", "assistant_cancelled")),
        );
      }),
  });
  return { runtime, pending };
}

function service(
  over: {
    runtime?: FakeRuntime;
    blocked?: { window: string; until: number | null } | null;
    bundle?: AssistantContextBundle;
  } = {},
) {
  const records: unknown[] = [];
  const logs: string[] = [];
  const contexts: unknown[] = [];
  const time = clock();
  const runtime = over.runtime ?? new FakeRuntime();
  const svc = new AssistantService({
    runtime,
    usage: { record: (entry) => records.push(entry) },
    quota: { blocked: () => over.blocked ?? null },
    scanner: new SecretScanner(),
    context: async (source) => {
      contexts.push(source);
      return over.bundle ?? bundle;
    },
    dataDir: "/data",
    allowApiKey: false,
    timers: time.timers,
    now: () => Date.parse("2026-11-05T10:00:00.000Z") + time.now(),
    log: (line) => logs.push(line),
  });
  return { svc, runtime, records, logs, contexts, time };
}

const bundle: AssistantContextBundle = {
  stat: " a.ts | 1 +",
  diff: "--- a.ts\n@@ -0,0 +1 @@\n+export const a = 1;",
  notShown: [],
  redactedLines: 0,
  truncated: false,
  rules: "",
  recent: ["feat: one", "fix: two"],
  conventional: true,
};

const run = (over: Partial<AssistantRunPayload> = {}): AssistantRunPayload => ({
  requestId: "r1",
  kind: "card.title",
  text: "fix the login bug",
  language: "en",
  profile: "quick",
  ...over,
});

async function reason(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof FlightdeckError ? [error.reason, error.params ?? {}] : String(error);
  }
}

describe("assistant-service", () => {
  test("a field: the host's model for the profile, its answer checked, the usage recorded under the assistant", async () => {
    const { svc, runtime, records } = service();
    const result = await svc.run(run({ cwd: "/w/app" }));
    expect(result).toEqual({
      text: "improved: fix the login bug",
      model: "claude-haiku-5-5",
      provider: "host",
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
      stopReason: "success",
      notices: [],
    });
    const call = runtime.completeCalls[0];
    expect([call?.cwd, call?.effort, call?.thinking, call?.allowApiKey, call?.prompt]).toEqual([
      assistantDir("/data"),
      "low",
      "off",
      false,
      "<text>\nfix the login bug\n</text>",
    ]);
    expect(records).toEqual([
      {
        at: "2026-11-05T10:00:00.000Z",
        model: "claude-haiku-5-5",
        tokens: { ...TOKENS, model: "claude-haiku-5-5" },
        projectPath: "/w/app",
        messageId: "assistant-r1",
        origin: "assistant",
        provider: "host",
      },
    ]);
    await svc.run(run({ requestId: "r2", profile: "careful", model: undefined }));
    expect(runtime.completeCalls[1]?.model).toBe("claude-sonnet-5-5");
    expect((records[1] as { projectPath: string }).projectPath).toBe(join("/data", "assistant"));
  });

  test("the checks in order, and nothing starts when one fails: empty, size, secret, quota", async () => {
    const { svc, runtime, contexts } = service({
      blocked: { window: "five_hour", until: Date.parse("2026-11-05T12:00:00.000Z") },
    });
    expect(await reason(svc.run(run({ kind: "prompt", text: "  " })))).toEqual([
      "assistant_empty_input",
      {},
    ]);
    expect(await reason(svc.run(run({ text: "x".repeat(100_001) })))).toEqual([
      "assistant_too_long",
      { max: 100_000 },
    ]);
    expect(await reason(svc.run(run({ text: "password=hunter2hunter2" })))).toEqual([
      "assistant_secret_found",
      { labels: "senha na linha" },
    ]);
    expect(await reason(svc.run(run()))).toEqual([
      "assistant_quota_blocked",
      { until: "2026-11-05T12:00:00.000Z" },
    ]);
    expect([runtime.completeCalls.length, contexts.length]).toEqual([0, 0]);
  });

  test("a commit message reads the repo; a secret in the diff refuses; the commit notices come with the answer", async () => {
    const secret = service({
      bundle: { ...bundle, diff: "+const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'" },
    });
    const source = { kind: "card" as const, cardId: "c1" };
    const refused = await reason(secret.svc.run(run({ kind: "commit.message", text: "", source })));
    expect(Array.isArray(refused) ? refused[0] : refused).toBe("assistant_secret_found");
    expect(secret.runtime.completeCalls.length).toBe(0);
    const ok = service({
      runtime: new FakeRuntime({
        complete: () => ({ text: "Add the a constant.", subtype: "success", tokens: TOKENS }),
      }),
      bundle: { ...bundle, truncated: true, redactedLines: 2 },
    });
    const result = await ok.svc.run(
      run({ kind: "commit.message", text: "", source, profile: "careful" }),
    );
    expect([result.text, result.notices]).toEqual([
      "Add the a constant.",
      ["subject_trailing_period", "subject_not_conventional", "diff_truncated", "lines_redacted"],
    ]);
    expect(ok.contexts).toEqual([source]);
    expect(ok.runtime.completeCalls[0]?.prompt).toContain("<diff>\n a.ts | 1 +");
  });

  test("a snippet's variables are guarded, and an answer that cannot be used is refused", async () => {
    const changed = service({
      runtime: new FakeRuntime({
        complete: () => ({ text: "Review {{path}}", subtype: "success" }),
      }),
    });
    expect(
      await reason(changed.svc.run(run({ kind: "snippet.prompt", text: "Review {{file}}" }))),
    ).toEqual(["assistant_placeholders_changed", {}]);
    const empty = service({
      runtime: new FakeRuntime({ complete: () => ({ text: "  ", subtype: "success" }) }),
    });
    expect(await reason(empty.svc.run(run()))).toEqual(["assistant_bad_output", {}]);
  });

  test("one run at a time: a second waits for the first, and gives up after 10 s", async () => {
    const held = heldRuntime();
    const { svc, time } = service({ runtime: held.runtime });
    const first = svc.run(run({ requestId: "a" }));
    await Bun.sleep(0);
    const second = svc.run(run({ requestId: "b" }));
    await Bun.sleep(0);
    expect(held.pending.length).toBe(1);
    held.pending[0]?.answer("first");
    expect((await first).text).toBe("first");
    await Bun.sleep(0);
    expect(held.pending.length).toBe(2);
    const third = reason(svc.run(run({ requestId: "c" })));
    time.advance(10_000);
    expect(await third).toEqual(["assistant_rate_limited", {}]);
    held.pending[1]?.answer("second");
    expect((await second).text).toBe("second");
  });

  test("cancel by request id stops the call; the 90 s ceiling times it out", async () => {
    const held = heldRuntime();
    const { svc, time } = service({ runtime: held.runtime });
    const cancelled = reason(svc.run(run({ requestId: "a" })));
    await Bun.sleep(0);
    svc.cancel("a");
    svc.cancel("unknown");
    expect(await cancelled).toEqual(["assistant_cancelled", {}]);
    const slow = reason(svc.run(run({ requestId: "b" })));
    await Bun.sleep(0);
    time.advance(90_000);
    expect(await slow).toEqual(["assistant_timeout", {}]);
  });

  test("the logs say the kind, provider, model, time and tokens, never the text", async () => {
    const { svc, logs } = service();
    await svc.run(run({ text: "a very private note about the login" }));
    expect(logs).toEqual(["assistant card.title host claude-haiku-5-5 0 ms in 100 out 20"]);
  });

  test("the app's own calls are recorded by id, with their provider and reported cost; context reads the repo", async () => {
    const { svc, records, contexts } = service();
    svc.record({
      id: "r9",
      at: "2026-11-05T09:00:00.000Z",
      provider: "openrouter",
      model: "anthropic/claude-haiku-5.5",
      tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1 },
      costUsd: 0.001,
    });
    expect(records).toEqual([
      {
        at: "2026-11-05T09:00:00.000Z",
        model: "anthropic/claude-haiku-5.5",
        tokens: {
          model: "anthropic/claude-haiku-5.5",
          speed: "standard",
          input: 10,
          output: 5,
          cacheRead: 2,
          cacheWrite5m: 1,
          cacheWrite1h: 0,
        },
        projectPath: join("/data", "assistant"),
        messageId: "assistant-r9",
        origin: "assistant",
        provider: "openrouter",
        costUsd: 0.001,
      },
    ]);
    expect(await svc.context({ kind: "pr", source: { kind: "worktree", cwd: "/w" } })).toEqual(
      bundle,
    );
    expect(contexts).toEqual([{ kind: "worktree", cwd: "/w" }]);
  });
});
