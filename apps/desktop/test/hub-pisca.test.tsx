import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

registerDom();
const { act, cleanup } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");

setDefaultTimeout(20_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const managed = (id: string) => ({
  id,
  name: null,
  cwd: `/r/${id}`,
  status: "idle",
  permissionMode: "default",
  model: null,
  claudeSessionId: `c-${id}`,
  lastSeq: 0,
  createdAt: "2026-10-30T10:00:00.000Z",
  updatedAt: "2026-10-30T11:00:00.000Z",
  projectKey: null,
});

async function online() {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.hub.managed = [managed("s1"), managed("s2")];
  await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
  const deadline = Date.now() + 5000;
  while (store.getState().hosts[0]?.status !== "online" && Date.now() < deadline) {
    await act(() => Bun.sleep(10));
  }
  const hostId = store.getState().hosts[0]?.id ?? "";
  return { store, daemon, hostId };
}

describe("hub-pisca: the Sessions list does not blink", () => {
  test("a refresh whose request fails keeps the sessions the host last listed", async () => {
    const { store, daemon, hostId } = await online();
    await store.refreshHub();
    const ids = () => store.getState().hub[hostId]?.managed.map((s) => s.id);
    expect(ids()).toEqual(["s1", "s2"]);
    // A busy host (a slow answer, a refusal) makes this one request fail; the next refresh is fine.
    daemon.refuse.set("session.list", "busy");
    await store.refreshHub();
    expect(ids()).toEqual(["s1", "s2"]);
    daemon.refuse.delete("session.list");
    daemon.hub.managed = [managed("s1")];
    await store.refreshHub();
    expect(ids()).toEqual(["s1"]);
  });
});
