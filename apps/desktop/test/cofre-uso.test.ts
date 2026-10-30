import { describe, expect, test } from "bun:test";
import type { VaultUsed } from "@flightdeck/protocol";
import type { VaultOutcome } from "../src/lib/vault-requests.ts";
import { VaultUsageLog } from "../src/lib/vault-usage.ts";
import { memoryPlatform } from "./fixtures.ts";

const VALUE = "usage-test-value-456";

const DELIVERED: VaultOutcome = {
  hostId: "h1",
  secretId: "s1",
  purpose: "ssh",
  requester: "claude",
  delivered: true,
  reason: "",
};
const DENIED: VaultOutcome = {
  hostId: "h2",
  secretId: "s2",
  purpose: "deploy",
  requester: "automation",
  delivered: false,
  reason: "denied by policy",
};
const USED: VaultUsed = {
  type: "vault.used",
  secretId: "s1",
  purpose: "ssh",
  requester: "claude",
  action: "ssh deploy@box",
  at: "2026-10-30T10:00:00.000Z",
};

function setup(options: ConstructorParameters<typeof VaultUsageLog>[1] = {}) {
  const { platform } = memoryPlatform();
  let now = 1000;
  const log = new VaultUsageLog(platform, { clock: () => now++, ...options });
  return { platform, log };
}

describe("cofre-uso", () => {
  test("a delivered request becomes a line with the secret, host, purpose, requester and time", () => {
    const { log } = setup();
    const entry = log.recordOutcome(DELIVERED);
    expect(entry).toEqual({
      secretId: "s1",
      hostId: "h1",
      purpose: "ssh",
      requester: "claude",
      at: 1000,
      kind: "delivered",
      detail: "",
    });
    expect(log.list()).toEqual([entry]);
  });

  test("a refused request becomes a denied line with the reason", () => {
    const { log } = setup();
    const entry = log.recordOutcome(DENIED);
    expect(entry.kind).toBe("denied");
    expect(entry.detail).toBe("denied by policy");
  });

  test("the daemon's use report becomes a used line, timed by the report", () => {
    const { log } = setup();
    const entry = log.recordUsed("h1", USED);
    expect(entry).toEqual({
      secretId: "s1",
      hostId: "h1",
      purpose: "ssh",
      requester: "claude",
      at: Date.parse(USED.at),
      kind: "used",
      detail: "ssh deploy@box",
    });
  });

  test("the list is newest first and survives a new log on the same storage", () => {
    const { platform, log } = setup();
    log.recordOutcome(DELIVERED);
    log.recordOutcome(DENIED);
    const again = new VaultUsageLog(platform);
    expect(again.list().map((e) => e.secretId)).toEqual(["s2", "s1"]);
  });

  test("the filters narrow the list by secret, host, requester, purpose and kind", () => {
    const { log } = setup();
    log.recordOutcome(DELIVERED);
    log.recordOutcome(DENIED);
    log.recordUsed("h1", USED);
    expect(log.list({ secretId: "s1" })).toHaveLength(2);
    expect(log.list({ hostId: "h2" })).toHaveLength(1);
    expect(log.list({ requester: "automation" })[0]?.secretId).toBe("s2");
    expect(log.list({ purpose: "ssh" })).toHaveLength(2);
    expect(log.list({ kind: "used" })).toHaveLength(1);
    expect(log.list({ secretId: "s1", kind: "denied" })).toEqual([]);
  });

  test("the log keeps only the newest lines up to its limit", () => {
    const { log } = setup({ limit: 2 });
    log.recordOutcome({ ...DELIVERED, secretId: "a" });
    log.recordOutcome({ ...DELIVERED, secretId: "b" });
    log.recordOutcome({ ...DELIVERED, secretId: "c" });
    expect(log.list().map((e) => e.secretId)).toEqual(["c", "b"]);
  });

  test("no stored line holds a secret's value", () => {
    const { platform, log } = setup();
    log.recordOutcome({ ...DELIVERED, reason: "" });
    log.recordUsed("h1", USED);
    expect(platform.storage.getItem("flightdeck.vault-usage")).not.toContain(VALUE);
    expect(Object.keys(log.list()[0] ?? {}).sort()).toEqual(
      ["at", "detail", "hostId", "kind", "purpose", "requester", "secretId"].sort(),
    );
  });
});
