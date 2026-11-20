import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { join } from "node:path";
import { parseArgs } from "../../src/main.ts";
import { keyIdOf, sha256Hex } from "../../src/permissions/domain/approval-gate.ts";
import { Approvers } from "../../src/permissions/index.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { TOKEN } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";
import { tempDir } from "../support/helpers.ts";

/** `flightdeckd approvers enroll|reset` (#3439): the host terminal writes the store; no protocol command does. */
const stores: EventStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

/** A data dir with a config that points at no daemon: these commands never ask one. */
async function host() {
  const dataDir = tempDir("fd-approvers-");
  const config = JSON.stringify({ token: TOKEN, dataDir, port: 1 });
  const store = await EventStore.open(join(dataDir, "flightdeck.db"));
  stores.push(store);
  const approvers = new Approvers(store.db, {
    now: () => new Date(),
    mono: () => performance.now(),
    random: () => crypto.randomUUID().replaceAll("-", ""),
  });
  const run = (...argv: string[]) => flightdeckd(["approvers", ...argv], 1, config);
  const addKey = () => {
    const spki = generateKeyPairSync("ec", { namedCurve: "P-256" })
      .publicKey.export({ type: "spki", format: "der" })
      .toString("base64");
    approvers.store.add({
      keyId: keyIdOf(spki),
      publicKey: spki,
      name: "phone",
      client: "app",
      address: "127.0.0.1",
      enrolledAt: new Date().toISOString(),
    });
  };
  return { approvers, run, addKey };
}

describe("approvers: the command line", () => {
  test("enroll and reset are the only actions, and --json is accepted", () => {
    expect(parseArgs(["approvers", "enroll", "--json"])).toMatchObject({
      command: "approvers",
      action: "enroll",
      json: true,
    });
    expect(parseArgs(["approvers", "reset"])).toMatchObject({
      command: "approvers",
      action: "reset",
    });
    expect(() => parseArgs(["approvers", "add"])).toThrow("invalid approvers action");
    expect(() => parseArgs(["approvers"])).toThrow("invalid approvers action");
  });

  test("Given no key, When enroll runs, Then a window opens for ten minutes with the hash of the code it prints", async () => {
    const { approvers, run } = await host();
    const before = Date.now();
    const result = await run("enroll", "--json");
    expect(result.code).toBe(0);
    expect(result.err).toEqual([]);
    expect(result.out).toHaveLength(1);
    const printed = JSON.parse(result.out.join("\n")) as { code: string; expiresAt: string };
    expect(printed.code.length).toBeGreaterThanOrEqual(22);
    const window = approvers.store.window();
    expect(window?.codeHash).toBe(sha256Hex(printed.code));
    expect(window?.codeHash).not.toContain(printed.code);
    const until = window?.until.getTime() ?? 0;
    expect(until).toBeGreaterThanOrEqual(before + 600_000 - 1_000);
    expect(until).toBeLessThanOrEqual(Date.now() + 600_000 + 1_000);
    expect(printed.expiresAt).toBe(window?.until.toISOString() ?? "");
  });

  test("enroll says the code and the minutes in words, and two runs give two different codes", async () => {
    const { approvers, run } = await host();
    const first = await run("enroll");
    const hashOne = approvers.store.window()?.codeHash;
    const second = await run("enroll");
    expect(first.out.join("\n")).toContain("10 minutes");
    expect(first.out.join("\n")).not.toBe(second.out.join("\n"));
    expect(approvers.store.window()?.codeHash).not.toBe(hashOne);
  });

  test("Given a key, When enroll runs, Then it is refused with exit 1 and the window stays closed: only a key adds a key", async () => {
    const { approvers, run, addKey } = await host();
    addKey();
    const result = await run("enroll");
    expect(result.code).toBe(1);
    expect(result.out).toEqual([]);
    expect(result.err.join("\n")).toContain("approvers reset");
    expect(approvers.store.window()).toBeNull();
  });

  test("Given two keys and a window, When reset runs, Then every key and the window go and the daemon keeps its id", async () => {
    const { approvers, run, addKey } = await host();
    const id = approvers.daemonId();
    addKey();
    addKey();
    approvers.store.openWindow(sha256Hex("c"), new Date(Date.now() + 60_000));
    const result = await run("reset", "--json");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out.join("\n"))).toEqual({ removed: 2 });
    expect(approvers.keys()).toEqual([]);
    expect(approvers.store.window()).toBeNull();
    expect(approvers.daemonId()).toBe(id);
  });

  test("reset without --json says how many devices went", async () => {
    const { run, addKey } = await host();
    addKey();
    expect((await run("reset")).out).toEqual(["removed 1 enrolled device: protection is off"]);
    expect((await run("reset")).out).toEqual(["no enrolled device: protection is off"]);
  });
});
