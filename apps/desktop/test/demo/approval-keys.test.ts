import { describe, expect, test } from "bun:test";
import {
  DEMO_NEW_KEY,
  DEMO_OTHER_KEY,
  DEMO_THIS_KEY,
  demoApprovalKeys,
} from "../../src/demo/approval-keys.ts";
import { keyIdOf } from "../../src/features/approval/add-text.ts";

describe("the demo's device keys (#4154)", () => {
  test("each key's id is the SHA-256 of its public key, and the three differ", async () => {
    const keys = [DEMO_THIS_KEY, DEMO_OTHER_KEY, DEMO_NEW_KEY];
    expect(await Promise.all(keys.map((key) => keyIdOf(key.publicKey)))).toEqual(
      keys.map((key) => key.keyId),
    );
    expect(new Set(keys.map((key) => key.keyId)).size).toBe(3);
  });

  test("an enrolled store holds this device's key until it is deleted", async () => {
    const store = demoApprovalKeys("enrolled", () => {});
    const before = await store.get("daemon-1");
    await store.delete("daemon-1");
    expect([before, await store.get("daemon-1")]).toEqual([DEMO_THIS_KEY, null]);
  });

  test("an empty store holds nothing until the page makes a key, which is the new device's", async () => {
    const store = demoApprovalKeys("empty", () => {});
    const before = await store.get("daemon-1");
    const made = await store.create("daemon-1");
    expect([before, made, await store.get("daemon-1")]).toEqual([null, DEMO_NEW_KEY, DEMO_NEW_KEY]);
  });

  test("the host ids the page asks about are heard, and a signature is a fixed text", async () => {
    const heard: string[] = [];
    const store = demoApprovalKeys("enrolled", (id) => heard.push(id));
    await store.get("daemon-1");
    await store.create("daemon-2");
    expect([heard, (await store.sign("daemon-1", "m", "en")).length > 0]).toEqual([
      ["daemon-1", "daemon-2"],
      true,
    ]);
  });
});
