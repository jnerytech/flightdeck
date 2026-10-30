import { describe, expect, test } from "bun:test";
import type { VaultRequestFrame } from "@flightdeck/protocol";
import { actionPolicy, SIBLING_MS } from "../src/lib/vault-approval.ts";
import type { VaultRequestContext } from "../src/lib/vault-requests.ts";

const frame = (over: Partial<VaultRequestFrame> = {}): VaultRequestFrame => ({
  type: "vault.request",
  requestId: "r1",
  secretId: "tok",
  purpose: "action:deploy:r1",
  requester: "claude",
  action: "deploy",
  params: { branch: "main" },
  approval: "first-per-session",
  ...over,
});
const context = (request: VaultRequestFrame): VaultRequestContext => ({
  request,
  hostId: "h1",
  secret: null,
});

/** A policy whose questions are recorded and answered by `answers`, on a clock the test moves. */
function setup(answers: boolean[] = [true]) {
  const asked: string[] = [];
  let now = 1_000;
  const policy = actionPolicy({
    ask: async (ctx) => {
      asked.push(ctx.request.secretId);
      return answers.shift() ?? false;
    },
    now: () => now,
  });
  return { policy, asked, advance: (ms: number) => (now += ms) };
}

describe("acoes-ui-aprovacao: the policy for the daemon's requests", () => {
  test("a request that names neither an action nor a command is denied without asking", async () => {
    const { policy, asked } = setup();
    const decision = await policy(context(frame({ action: undefined })));
    expect(decision.kind).toBe("deny");
    expect(asked).toEqual([]);
  });

  test("an action that never asks is delivered without a question", async () => {
    const { policy, asked } = setup();
    expect(await policy(context(frame({ approval: "never" })))).toEqual({ kind: "deliver" });
    expect(asked).toEqual([]);
  });

  test("first-per-session asks once per action and requester, then remembers", async () => {
    const { policy, asked, advance } = setup([true, true]);
    expect(await policy(context(frame()))).toEqual({ kind: "deliver" });
    advance(SIBLING_MS * 10);
    expect(await policy(context(frame({ requestId: "r2" })))).toEqual({ kind: "deliver" });
    expect(asked).toEqual(["tok"]);
    // Another action, or another requester, is a new question.
    await policy(context(frame({ action: "logs" })));
    await policy(context(frame({ requester: "automation" })));
    expect(asked.length).toBe(3);
  });

  test("always asks at every run", async () => {
    const { policy, asked, advance } = setup([true, true]);
    await policy(context(frame({ approval: "always" })));
    advance(SIBLING_MS * 10);
    await policy(context(frame({ approval: "always" })));
    expect(asked).toEqual(["tok", "tok"]);
  });

  test("the other secrets of an approved run are delivered without a second question, for a while", async () => {
    const { policy, asked, advance } = setup([true, true]);
    const run = { approval: "always" } as const;
    await policy(context(frame({ ...run, secretId: "a" })));
    advance(1_000);
    expect(await policy(context(frame({ ...run, secretId: "b" })))).toEqual({ kind: "deliver" });
    expect(asked).toEqual(["a"]);
    // The same secret again is a new run, and so is a secret asked for after the window.
    await policy(context(frame({ ...run, secretId: "a" })));
    advance(SIBLING_MS + 1);
    await policy(context(frame({ ...run, secretId: "c" })));
    expect(asked).toEqual(["a", "a", "c"]);
  });

  test("a free command is asked every time, even after the same one was approved", async () => {
    const { policy, asked, advance } = setup([true, true]);
    const free: Partial<VaultRequestFrame> = {
      action: undefined,
      command: "make deploy",
      secrets: ["tok"],
      approval: "never",
    };
    await policy(context(frame(free)));
    advance(SIBLING_MS * 10);
    await policy(context(frame(free)));
    expect(asked).toEqual(["tok", "tok"]);
  });

  test("a no is a denial, and the next request asks again", async () => {
    const { policy, asked } = setup([false, true]);
    const first = await policy(context(frame()));
    expect(first.kind).toBe("deny");
    expect(await policy(context(frame()))).toEqual({ kind: "deliver" });
    expect(asked.length).toBe(2);
  });

  test("two secrets asked at once for the same run share one question", async () => {
    const { policy, asked } = setup([true]);
    const [a, b] = await Promise.all([
      policy(context(frame({ secretId: "a" }))),
      policy(context(frame({ secretId: "b" }))),
    ]);
    expect([a.kind, b.kind]).toEqual(["deliver", "deliver"]);
    expect(asked).toEqual(["a"]);
  });

  test("a secret of the run that needs holding is asked again: one held approval covers one request", async () => {
    const asked: string[] = [];
    const approved: string[] = [];
    const policy = actionPolicy({
      ask: async (ctx) => {
        asked.push(ctx.request.secretId);
        return true;
      },
      approve: async (ctx) => {
        approved.push(ctx.request.secretId);
      },
      now: () => 1_000,
    });
    const run = { approval: "always", decision: "ask", needsHold: true } as const;
    await policy(context(frame({ ...run, secretId: "a" })));
    await policy(context(frame({ ...run, secretId: "b" })));
    expect(asked).toEqual(["a", "b"]);
    expect(approved).toEqual(["a", "b"]);
  });
});
