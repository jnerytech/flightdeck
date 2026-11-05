import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AssistantContextBundle,
  type AssistantRunPayload,
  SecretScanner,
} from "@flightdeck/protocol";
import { assistantService } from "../src/assistant/factory.ts";
import { assistantDir } from "../src/assistant/paths.ts";
import { AssistantService } from "../src/assistant/service.ts";
import { FlightdeckError } from "../src/errors.ts";
import { startDaemon } from "../src/main.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import type { CompleteOptions, CompleteResult } from "../src/runtime/types.ts";
import { startServer } from "../src/server.ts";
import { git, gitRepo } from "./board-helpers.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

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

describe("assistant-service: the factory and the server", () => {
  const factoryDeps = (over: object = {}) => ({
    runtime: new FakeRuntime(),
    usage: { record: () => {} },
    scanner: new SecretScanner(),
    dataDir: "/data",
    allowApiKey: false,
    allowedRoots: [] as string[],
    ...over,
  });

  test("the factory reads a card's branch from the board and a folder inside the allowed roots", async () => {
    const { root, repo } = gitRepo();
    git(repo, "checkout", "-q", "-b", "feature");
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    const board = {
      getCard: (id: string) => ({ id, worktreePath: id === "c1" ? repo : null, projectId: "p1" }),
      getProject: () => ({ baseBranch: "main" }),
    };
    const svc = assistantService(factoryDeps({ board, allowedRoots: [root] })) as AssistantService;
    const card = await svc.context({ kind: "commit", source: { kind: "card", cardId: "c1" } });
    expect(card.stat).toBe(" a.ts | 1 +");
    expect(
      (await svc.context({ kind: "commit", source: { kind: "worktree", cwd: repo } })).stat,
    ).toBe(" a.ts | 1 +");
    expect(
      await reason(svc.context({ kind: "commit", source: { kind: "card", cardId: "c2" } })),
    ).toEqual(["card_no_worktree", {}]);
    expect(
      await reason(
        svc.context({ kind: "commit", source: { kind: "worktree", cwd: "/elsewhere" } }),
      ),
    ).toEqual(["cwd_outside_roots", { cwd: "/elsewhere" }]);
    const boardless = assistantService(factoryDeps()) as AssistantService;
    expect(
      await reason(boardless.context({ kind: "commit", source: { kind: "card", cardId: "c1" } })),
    ).toEqual(["feature_off", { feature: "board" }]);
  });

  test("a runtime that cannot complete gives no assistant", () => {
    const { complete: _ignored, ...plain } = { complete: 1, start: () => {} };
    expect(assistantService(factoryDeps({ runtime: plain }))).toBe(undefined);
  });

  test("the server announces the assistant and answers its commands; without it they are off", async () => {
    const { manager } = newManager();
    const svc = assistantService(factoryDeps()) as AssistantService;
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: "t".repeat(24),
      allowedRoots: [],
      assistant: svc,
    });
    const off = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: "t".repeat(24),
      allowedRoots: [],
    });
    const client = new FrameClient(server.url);
    const bare = new FrameClient(off.url);
    try {
      for (const c of [client, bare])
        await c.request("hello", { token: "t".repeat(24), client: "test" });
      const features = async (c: FrameClient) =>
        (await c.data<{ features?: string[] }>("host.info", {}))?.features ?? [];
      expect([
        (await features(client)).includes("assistant"),
        (await features(bare)).includes("assistant"),
      ]).toEqual([true, false]);
      const answer = await client.data<{ text: string }>("assistant.run", {
        requestId: "r1",
        kind: "card.title",
        text: "fix the login bug",
        language: "en",
        profile: "quick",
      });
      expect(answer?.text).toBe("improved: fix the login bug");
      expect((await client.request("assistant.cancel", { requestId: "r1" })).ok).toBe(true);
      const record = {
        id: "x",
        at: "2026-11-05T10:00:00.000Z",
        provider: "anthropic",
        model: "claude-haiku-5-5",
        tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      };
      expect((await client.request("assistant.record", record)).ok).toBe(true);
      const context = await client.request("assistant.context", {
        kind: "commit",
        source: { kind: "staged", cwd: "/nowhere" },
      });
      expect((context.error as { reason?: string } | undefined)?.reason).toBe("cwd_outside_roots");
      const refused = await bare.request("assistant.run", {
        requestId: "r2",
        kind: "card.title",
        text: "x",
        language: "en",
        profile: "quick",
      });
      expect((refused.error as { reason?: string; params?: unknown } | undefined)?.params).toEqual({
        feature: "assistant",
      });
    } finally {
      client.close();
      bare.close();
      await server.stop();
      await off.stop();
    }
  });

  test("the daemon builds its assistant on its runtime: announced, and it answers", async () => {
    const dir = tempDir("fd-assistant-daemon-");
    const token = "a".repeat(24);
    const config = join(dir, "config.json");
    writeFileSync(
      config,
      JSON.stringify({ port: 0, token, dataDir: join(dir, "data"), allowedRoots: [dir] }),
    );
    const daemon = await startDaemon(
      { command: "start", config, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
    );
    const client = new FrameClient(daemon.url);
    try {
      await client.request("hello", { token, client: "test" });
      const info = await client.data<{ features?: string[] }>("host.info", {});
      const answer = await client.data<{ text: string }>("assistant.run", {
        requestId: "r1",
        kind: "card.title",
        text: "fix the login bug",
        language: "en",
        profile: "quick",
      });
      expect([info?.features?.includes("assistant"), answer?.text]).toEqual([
        true,
        "improved: fix the login bug",
      ]);
    } finally {
      client.close();
      await daemon.stop();
    }
  });
});
