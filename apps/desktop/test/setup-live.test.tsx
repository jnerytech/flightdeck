import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

const { AppStore } = await import("../src/lib/app-store.ts");
const { HostConnection } = await import("../src/lib/host-connection.ts");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(6000);

describe("setup-live: the checklist learns from a real host (issue #164)", () => {
  test("when a host comes online its hooks and projects are looked at, with no reload", async () => {
    const d = makeDaemon(cleanups);
    const asked: string[] = [];
    const real = HostConnection.prototype.request;
    HostConnection.prototype.request = function (this: HostConnection, type: string, ...rest) {
      if (type === "project.list") asked.push(type);
      return (real as (...args: unknown[]) => unknown).call(this, type, ...rest) as never;
    } as typeof real;
    cleanups.push(() => {
      HostConnection.prototype.request = real;
    });
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    const hostId = store.getState().hosts[0]?.id ?? "";
    await settle(() => store.getState().hosts[0]?.status === "online");
    // The hooks are not installed on a fresh host.
    await settle(() => store.getState().setupProbes[hostId]?.hooks === "absent");
    // The projects land in the probe, and the list the screens use (the sidebar tree reads it on
    // any page, #721) is filled from that same answer: one request, not two.
    await settle(() => store.getState().setupProbes[hostId]?.projects !== undefined);
    expect(store.getState().projects[hostId]).toEqual(
      store.getState().setupProbes[hostId]?.projects,
    );
    expect(asked).toEqual(["project.list"]);
    expect(store.getState().setupProbes[hostId]?.hooks).toBe("absent");
  });
});
