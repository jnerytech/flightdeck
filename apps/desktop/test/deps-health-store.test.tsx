import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { DepsResult } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, waitFor as pollFor, TOKEN } from "./fixtures.ts";

registerDom();
const { act, cleanup } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const RESULT: DepsResult = {
  items: [{ id: "claude", group: "required", state: "ok", breaks: [], fix: [] }],
};

async function connected() {
  const d = makeDaemon(cleanups, { firstRun: true, deps: RESULT });
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  await act(async () => {
    await store.addHost({ name: "pc", url: d.listen().url, token: TOKEN });
  });
  const hostId = await pollFor(() => store.getState().hosts[0]?.id, "the host");
  await pollFor(() => store.getState().healthAt[hostId] || undefined, "the first read");
  return { store, hostId };
}

type Request = (host: string, type: string, payload: unknown) => Promise<unknown>;
const refusal = (message: string) => ({ ok: false, code: "internal", message });

describe("deps-health-store: the background health read is silent and independent (HD-M3, HD-M4)", () => {
  test("a refusal gives no banner and no Retry, and the half that answered is kept", async () => {
    const { store, hostId } = await connected();
    const notices = store.getState().notices.length;
    (store as unknown as { hostRequest: Request }).hostRequest = async (_h, type) =>
      type === "deps.check" ? { ok: true, data: RESULT } : refusal("doctor is down");
    await store.checkHealth(hostId);
    expect(store.getState().notices).toHaveLength(notices);
    expect(store.getState().deps[hostId]).toEqual(RESULT);
    expect(store.getState().healthError[hostId]).toContain("doctor is down");
  });

  test("when both halves fail the error is kept for the screen, and a good read clears it", async () => {
    const { store, hostId } = await connected();
    const request = (store as unknown as { hostRequest: Request }).hostRequest.bind(store);
    (store as unknown as { hostRequest: Request }).hostRequest = async () => refusal("host busy");
    await store.checkHealth(hostId);
    expect(store.getState().healthError[hostId]).toContain("host busy");
    (store as unknown as { hostRequest: Request }).hostRequest = request;
    await store.checkHealth(hostId);
    expect(store.getState().healthError[hostId]).toBeUndefined();
  });

  test("two reads at the same time send one pair of commands and share the answer", async () => {
    const { store, hostId } = await connected();
    const asked: string[] = [];
    (store as unknown as { hostRequest: Request }).hostRequest = async (_h, type) => {
      asked.push(type);
      await new Promise((r) => setTimeout(r, 30));
      return type === "deps.check" ? { ok: true, data: RESULT } : refusal("n/a");
    };
    await Promise.all([store.checkHealth(hostId), store.checkHealth(hostId)]);
    expect(asked.sort()).toEqual(["deps.check", "doctor.run"]);
    await store.checkHealth(hostId);
    expect(asked).toHaveLength(4);
  });
});
