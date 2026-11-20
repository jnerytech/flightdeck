import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { FEATURE_APPROVAL_VAULT } from "@flightdeck/protocol";
import { Approvers } from "../../src/permissions/approvers.ts";
import { startServer } from "../../src/server.ts";
import { newManager } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { allow, echoDef, runCleanups, setup } from "../support/rules-approval.ts";

const TOKEN = "app-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  await runCleanups();
});

/** A daemon with approvers and the actions service, and an app that said hello. */
async function host(options: { approvers?: boolean; actions?: boolean } = {}) {
  const t = setup();
  const approvers = new Approvers(t.store.db, {
    now: () => new Date(),
    mono: () => performance.now(),
    random: () => randomBytes(24).toString("base64url"),
  });
  const { manager } = newManager();
  const server = startServer({
    manager,
    ...(options.approvers === false ? {} : { approvers }),
    ...(options.actions === false ? {} : { actions: t.actions }),
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "flightdeck-app" });
  /** A request of the actions service waiting for the person, for a secret with `tags`. */
  const ask = async (tags: string[], decision: "ask" | "allow" = "ask") => {
    await t.actions.save({ projectId: "p1", definition: echoDef({ tags }) });
    t.setRules([allow({ decision })]);
    const running = t.run();
    running.catch(() => {});
    return { frame: await t.frame(), running };
  };
  const challenge = (requestId: string) =>
    client.request("approval.challenge", { purpose: "approve", requestId });
  return { ...t, client, ask, challenge };
}

const refusal = (ack: Record<string, unknown>) =>
  ack.ok === false ? JSON.stringify((ack as { error?: unknown }).error) : "";

describe("vault-challenge: a nonce for the approval of a prod or high-risk secret use (#3452)", () => {
  test("Given a waiting request that needs the hold, Then a challenge gives a nonce good for 60 s", async () => {
    const t = await host();
    const { frame } = await t.ask(["producao"]);
    const ack = await t.challenge(frame.requestId);
    expect(ack.ok).toBe(true);
    expect((ack.data as { nonce: string; expiresInMs: number }).expiresInMs).toBe(60_000);
    expect((ack.data as { nonce: string }).nonce.length).toBeGreaterThan(0);
  });

  test("Given a request id nobody waits on, Then the challenge is refused as closed", async () => {
    const t = await host();
    expect(refusal(await t.challenge("no-such-request"))).toContain("permission_request_closed");
  });

  test("Given a waiting request that needs no hold, Then it takes no proof and no nonce is made for it", async () => {
    const t = await host();
    const { frame } = await t.ask([]);
    expect(refusal(await t.challenge(frame.requestId))).toContain("permission_request_closed");
  });

  test("Given a request the person already approved, Then no nonce is made for it again", async () => {
    const t = await host();
    const { frame } = await t.ask(["producao"]);
    t.actions.approve(frame.requestId, { via: "app", heldMs: 2000 });
    expect(refusal(await t.challenge(frame.requestId))).toContain("permission_request_closed");
  });

  test("Given approvers and actions, Then host.info announces the vault proof; without either it does not", async () => {
    const both = await host();
    const info = await both.client.data<{ features?: string[] }>("host.info", {});
    expect(info?.features).toContain(FEATURE_APPROVAL_VAULT);
    for (const missing of [{ approvers: false }, { actions: false }]) {
      const t = await host(missing);
      const got = await t.client.data<{ features?: string[] }>("host.info", {});
      expect(got?.features).not.toContain(FEATURE_APPROVAL_VAULT);
    }
  });
});
