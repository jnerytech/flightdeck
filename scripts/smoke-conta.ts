#!/usr/bin/env bun
/**
 * Account smoke (phase 34): a daemon server over the real readers, with a fake `claude` on PATH
 * (it only answers `auth status --json`) and a fake SDK query (account info and the usage
 * report). `account.watch` pushes the signed-in account with its plan and windows; a host that
 * is not signed in answers with the command to run; the fake `claude` is asked nothing but
 * `auth status`, and no token, credentials file or claude.ai address is ever touched.
 */
import { AccountState, AccountUpdated } from "@flightdeck/protocol";
import { Account } from "../apps/daemon/src/account/account.ts";
import { accountReaders } from "../apps/daemon/src/account/readers.ts";
import { spawnExec } from "../apps/daemon/src/exec.ts";
import { Quota } from "../apps/daemon/src/quota/quota.ts";
import { startServer } from "../apps/daemon/src/server.ts";
import { whichOnPath } from "../apps/daemon/src/which.ts";
import { newManager } from "../apps/daemon/test/helpers.ts";
import { FrameClient } from "../apps/daemon/test/history-helpers.ts";
import { installFakeCli } from "./test/fake-cli.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";
import { realTempDir } from "./test/temp-dir.ts";

/** Utilizations are floats read from JSON: compare within a tolerance, not exactly. */
const near = (value: number, wanted: number) => Math.abs(value - wanted) < 1e-9;

const home = installHomeGuard();
const TOKEN = "smoke-conta-token-0123456789abcdef";
const TIMEOUT_MS = 20_000;

let step = "prepare";
const log = (msg: string) => console.log(`  · ${msg}`);

async function until<T>(check: () => T | null | undefined | false, what: string): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await Bun.sleep(20); // NOSONAR: poll interval: the wait between looks is the point of this loop
  }
}

const SIGNED_IN = JSON.stringify({
  loggedIn: true,
  authMethod: "claude.ai",
  apiProvider: "firstParty",
  email: "demo@example.com",
  orgName: "Demo Org",
  subscriptionType: "max",
});
export const SIGNED_OUT = JSON.stringify({
  loggedIn: false,
  authMethod: "none",
  apiProvider: "firstParty",
});

/** A server over the real readers, the fake `claude` and the fake SDK query. */
async function host(statusJson: string, exitCode: number) {
  const fake = installFakeCli("claude", [
    { args: ["auth", "status"], stdout: statusJson, code: exitCode },
  ]);
  const claudePath = whichOnPath("claude");
  if (claudePath === null) throw new Error("the fake claude is not on PATH");
  const quota = new Quota({ pauseAt: 0.9 });
  const sdkCalls: string[] = [];
  const account = new Account({
    quota,
    readers: accountReaders({
      claudePath,
      exec: spawnExec,
      query: () => ({
        accountInfo: async () => {
          sdkCalls.push("accountInfo");
          return {
            email: "demo@example.com",
            organization: "Demo Org",
            subscriptionType: "Claude Max",
          };
        },
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
          sdkCalls.push("usage");
          return {
            subscription_type: "max",
            rate_limits_available: true,
            rate_limits: {
              five_hour: {
                utilization: 56,
                resets_at: new Date(Date.now() + 3_600_000).toISOString(),
              },
              seven_day: {
                utilization: 53,
                resets_at: new Date(Date.now() + 86_400_000).toISOString(),
              },
            },
          };
        },
        close: () => sdkCalls.push("close"),
      }),
    }),
  });
  const { manager, root } = newManager();
  const server = startServer({
    manager,
    quota,
    account,
    hostName: "smoke",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [root],
  });
  const client = new FrameClient(server.url);
  await client.request("hello", { token: TOKEN, client: "smoke-conta" });
  const stop = () => {
    client.close();
    void server.stop();
    quota.stop();
    fake.restore();
  };
  return { client, fake, sdkCalls, stop };
}

async function run() {
  step = "signed in: account.watch pushes the account";
  const signedIn = await host(SIGNED_IN, 0);
  try {
    const watch = await signedIn.client.request("account.watch", {});
    if (watch.ok !== true) throw new Error("account.watch was refused");
    const pushed = await until(
      () => signedIn.client.frames.find((f) => f.type === "account.updated"),
      "account.updated",
    );
    const state = AccountUpdated.parse(pushed);
    if (state.status !== "signed_in" || state.name !== "demo@example.com" || state.plan !== "max") {
      throw new Error(`unexpected account: ${JSON.stringify(state)}`);
    }
    const five = state.windows.find((w) => w.window === "five_hour")?.utilization;
    const seven = state.windows.find((w) => w.window === "seven_day")?.utilization;
    if (
      typeof five !== "number" ||
      typeof seven !== "number" ||
      !near(five, 0.56) ||
      !near(seven, 0.53)
    ) {
      throw new Error(`unexpected windows: ${JSON.stringify(state.windows)}`);
    }
    log(
      `signed in: ${state.plan}, 5 h ${Math.round(five * 100)}%, 7 d ${Math.round(seven * 100)}%`,
    );
    step = "the claude was asked nothing but auth status";
    const calls = signedIn.fake.calls();
    if (calls.length === 0 || calls.some((c) => c.join(" ") !== "auth status --json")) {
      throw new Error(`unexpected claude calls: ${JSON.stringify(calls)}`);
    }
  } finally {
    signedIn.stop();
  }

  step = "signed out: the command to run, and no windows";
  const signedOut = await host(SIGNED_OUT, 1);
  try {
    const ack = await signedOut.client.request("account.get", {});
    if (ack.ok !== true) throw new Error("account.get was refused");
    const state = AccountState.parse(ack.data);
    if (state.status !== "signed_out" || state.loginCommand !== "claude auth login") {
      throw new Error(`unexpected account: ${JSON.stringify(state)}`);
    }
    if (state.windows.length > 0 || state.name !== null) {
      throw new Error("a host that is not signed in must show no account and no windows");
    }
    if (signedOut.sdkCalls.length > 0) throw new Error("the SDK was asked on a signed-out host");
    log(`signed out: run \`${state.loginCommand}\``);
  } finally {
    signedOut.stop();
  }
}

realTempDir("flightdeck-smoke-conta-");
let code = 1;
try {
  await run();
  assertHomeGuard(home);
  console.log("SMOKE CONTA OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE CONTA FAIL at step "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
}
process.exit(code);
