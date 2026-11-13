import { describe, expect, test } from "bun:test";
import type { AccountState } from "@flightdeck/protocol";
import {
  type AccountCore,
  AccountSlice,
  initialAccountState,
} from "../../src/features/account/index.ts";

const ALFA = { name: "ana" } as unknown as AccountState;
const BETA = { name: "bia" } as unknown as AccountState;

/**
 * A slice over a bare state: `known` is what a host already knows, `fresh` what a refresh reads (null:
 * refused). `connected` says whether the host has a connection when the stream is asked for.
 */
function slice(known: AccountState | "silent" | "none" = ALFA, fresh: AccountState | null = BETA) {
  let state = initialAccountState();
  const watching: string[] = [];
  let connected = known !== "none";
  const core: AccountCore = {
    state: () => state,
    update: (patch) => {
      state = { ...state, ...patch };
    },
    stream: (hostId) => {
      if (!connected) return undefined;
      const id = `${hostId}#${watching.length}`;
      return {
        watch: (on) => {
          watching.push(`${on ? "on" : "off"} ${hostId}`);
        },
        get: () =>
          known === "silent" || known === "none"
            ? Promise.reject(new Error(`${id} cannot answer`))
            : Promise.resolve(known),
      };
    },
    refresh: async () => fresh,
  };
  return {
    account: new AccountSlice(core),
    state: () => state,
    watching,
    connect: () => {
      connected = true;
    },
  };
}

describe("account slice: the Claude account of a host", () => {
  test("watch turns the stream on, keeps what the host already knows, and its stop turns the stream off", async () => {
    const s = slice();
    const stop = s.account.watch("h1");
    await Promise.resolve();
    expect(s.watching).toEqual(["on h1"]);
    expect(s.state().account).toEqual({ h1: ALFA });
    stop();
    expect(s.watching).toEqual(["on h1", "off h1"]);
  });

  test("watch leaves the account unknown when the host has no connection or cannot answer", async () => {
    for (const known of ["none", "silent"] as const) {
      const s = slice(known);
      s.account.watch("h1");
      await Promise.resolve();
      expect(s.state().account).toEqual({});
    }
  });

  test("the stop of a watch begun with no connection does nothing to a connection that comes later", async () => {
    const s = slice("none");
    const stop = s.account.watch("h1");
    s.connect();
    s.account.watch("h1");
    stop();
    expect(s.watching).toEqual(["on h1"]);
  });

  test("refresh keeps the account the host read, and a refusal keeps what the app had", async () => {
    const ok = slice();
    expect(await ok.account.refresh("h1")).toBe(true);
    expect(ok.state().account).toEqual({ h1: BETA });
    const refused = slice(ALFA, null);
    refused.account.updated("h1", ALFA);
    expect(await refused.account.refresh("h1")).toBe(false);
    expect(refused.state().account).toEqual({ h1: ALFA });
  });

  test("the stream stays on while another card still watches the host, and goes off once with the last stop", async () => {
    const s = slice();
    const first = s.account.watch("h1");
    const second = s.account.watch("h1");
    first();
    first();
    expect(s.watching.filter((line) => line.startsWith("off"))).toEqual([]);
    second();
    expect(s.watching.filter((line) => line.startsWith("off"))).toEqual(["off h1"]);
  });

  test("a stop of one host does not touch the stream of another", async () => {
    const s = slice();
    const one = s.account.watch("h1");
    s.account.watch("h2");
    one();
    expect(s.watching).toEqual(["on h1", "on h2", "off h1"]);
  });

  test("an answer that comes after the stop is not kept", async () => {
    const s = slice();
    const stop = s.account.watch("h1");
    stop();
    await Promise.resolve();
    expect(s.state().account).toEqual({});
  });

  test("a removed host keeps no account, and an answer that comes after is not kept", async () => {
    const s = slice();
    s.account.updated("h1", ALFA);
    s.account.updated("h2", BETA);
    const refreshing = s.account.refresh("h1");
    const stop = s.account.watch("h1");
    s.account.forget("h1");
    await refreshing;
    await Promise.resolve();
    expect(s.state().account).toEqual({ h2: BETA });
    stop();
    expect(s.watching.filter((line) => line.startsWith("off"))).toEqual([]);
  });
});
