import { afterEach, describe, expect, test } from "bun:test";
import { AccountState, AccountUpdated } from "@flightdeck/protocol";
import { Account, type AccountReaders } from "../src/account/account.ts";
import type { AuthStatus } from "../src/account/readers.ts";
import { Quota } from "../src/quota/quota.ts";
import { startServer } from "../src/server.ts";
import { newManager, poll } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "account-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const signedIn: AuthStatus = {
  loggedIn: true,
  authMethod: "claude.ai",
  apiProvider: "firstParty",
  email: "demo@example.com",
  organization: "Demo Org",
  plan: "max",
};

async function connect(withAccount = true) {
  const quota = new Quota({ pauseAt: null });
  cleanups.push(() => quota.stop());
  const reads: number[] = [];
  const readers: AccountReaders = {
    status: async () => {
      reads.push(Date.now());
      return signedIn;
    },
    sdk: async () => ({
      info: null,
      usage: {
        plan: "max",
        available: true,
        windows: [
          {
            window: "five_hour",
            utilization: 0.56,
            status: "allowed",
            resetsAt: Date.now() + 3_600_000,
          },
        ],
      },
    }),
  };
  const account = new Account({ quota, readers });
  const { manager, root } = newManager();
  const server = startServer({
    manager,
    quota,
    ...(withAccount ? { account } : {}),
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [root],
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return { client, reads, quota, account };
}

describe("conta-protocolo: account.get, account.watch and account.refresh over the socket", () => {
  test("account.get answers with the schema's account and reads once when nothing was read", async () => {
    const { client, reads } = await connect();
    const ack = await client.request("account.get", {});
    expect(ack.ok).toBe(true);
    const state = AccountState.parse(ack.data);
    expect(state).toMatchObject({
      status: "signed_in",
      name: "demo@example.com",
      organization: "Demo Org",
      plan: "max",
      loginCommand: "claude auth login",
    });
    expect(state.windows.map((w) => w.window)).toEqual(["five_hour"]);
    await client.request("account.get", {});
    expect(reads.length).toBe(1);
  });

  test("account.watch acks, pushes account.updated after the read, and again for a stream reading", async () => {
    const { client, quota } = await connect();
    expect((await client.request("account.watch", {})).ok).toBe(true);
    const first = await poll(() => client.frames.find((f) => f.type === "account.updated"), 3000);
    expect(AccountUpdated.safeParse(first).success).toBe(true);
    expect(first).toMatchObject({ status: "signed_in", name: "demo@example.com" });
    const before = client.frames.filter((f) => f.type === "account.updated").length;
    quota.record([
      {
        window: "seven_day",
        utilization: 0.3,
        status: "allowed",
        resetsAt: Date.now() + 86_400_000,
      },
    ]);
    await poll(
      () => client.frames.filter((f) => f.type === "account.updated").length > before,
      3000,
    );
    const last = client.frames.filter((f) => f.type === "account.updated").at(-1);
    expect(JSON.stringify(last)).toContain("seven_day");
  });

  test("a closed connection stops the watch", async () => {
    const { client, account } = await connect();
    await client.request("account.watch", {});
    await poll(() => client.frames.find((f) => f.type === "account.updated"), 3000);
    expect((account as unknown as { watchers: Set<unknown> }).watchers.size).toBe(1);
    client.close();
    await poll(() => (account as unknown as { timer: unknown }).timer === null, 3000);
    expect((account as unknown as { watchers: Set<unknown> }).watchers.size).toBe(0);
  });

  test("account.refresh reads now, and a second one right after is refused with the seconds to wait", async () => {
    const { client } = await connect();
    const ok = await client.request("account.refresh", {});
    expect(ok.ok).toBe(true);
    expect(AccountState.safeParse(ok.data).success).toBe(true);
    const refused = await client.request("account.refresh", {});
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("invalid_state");
    expect(refused.error?.reason).toBe("account_refresh_too_soon");
    const wait = refused.error?.params?.waitSeconds;
    expect(typeof wait === "number" && wait > 0 && wait <= 30).toBe(true);
  });

  test("the commands take no fields", async () => {
    const { client } = await connect();
    expect((await client.request("account.get", {})).ok).toBe(true);
    for (const type of ["account.get", "account.watch", "account.refresh"]) {
      const ack = await client.request(type, { extra: 1 });
      expect(ack.ok).toBe(false);
      expect(ack.error?.code).toBe("bad_request");
    }
  });

  test("a daemon without the account refuses the commands and does not announce the feature", async () => {
    const { client } = await connect(false);
    const ack = await client.request("account.get", {});
    expect(ack.ok).toBe(false);
    expect(ack.error?.reason).toBe("feature_off");
    const info = await client.request("host.info", {});
    expect((info.data as { features: string[] }).features).not.toContain("account");
  });

  test("host.info announces the account feature when the daemon has it", async () => {
    const { client } = await connect();
    const info = await client.request("host.info", {});
    expect((info.data as { features: string[] }).features).toContain("account");
  });
});
