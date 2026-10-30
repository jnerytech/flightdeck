import { afterEach, describe, expect, test } from "bun:test";
import { AppStore } from "../src/lib/app-store.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "./fixtures.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function setup() {
  const d = makeDaemon(cleanups, { terminals: true });
  const server = d.listen();
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 10, maxDelayMs: 20 });
  cleanups.push(() => store.dispose());
  const hostId = await store.addHost({ name: "pc", url: server.url, token: TOKEN });
  await waitFor(() => store.getState().hosts.find((h) => h.id === hostId)?.status === "online");
  return { ...d, server, store, hostId };
}

function listener() {
  const seen: string[] = [];
  return {
    seen,
    handlers: {
      data: (base64: string) => void seen.push(`data:${atob(base64)}`),
      exited: (code: number) => void seen.push(`exited:${code}`),
      resync: () => void seen.push("resync"),
      offline: () => void seen.push("offline"),
    },
  };
}

describe("terminal-ui: the store follows a host's terminal", () => {
  test("terminalHost opens, attaches and writes; followTerminal gets the output and the exit", async () => {
    const { store, hostId, project, ptys } = await setup();
    const host = store.terminalHost(hostId);
    const { terminalId } = await host.open(project, 80, 24);
    const { seen, handlers } = listener();
    const stop = store.followTerminal(hostId, terminalId, handlers);
    const attached = await host.attach(terminalId);
    expect(attached.terminalId).toBe(terminalId);
    await host.write(terminalId, "oi\r");
    await waitFor(() => seen.includes("data:oi\r")).catch(() => null);
    expect(seen).toContain("data:oi\r");
    await host.resize(terminalId, 100, 30);
    expect(ptys.spawned[0]?.resized).toEqual([[100, 30]]);
    ptys.spawned[0]?.exit(2);
    await waitFor(() => seen.includes("exited:2")).catch(() => null);
    expect(seen).toContain("exited:2");
    stop();
  });

  test("a stopped follower hears nothing more; losing the host tells the live ones", async () => {
    const { store, hostId, project, server, ptys } = await setup();
    const host = store.terminalHost(hostId);
    const { terminalId } = await host.open(project, 80, 24);
    await host.attach(terminalId);
    const stopped = listener();
    store.followTerminal(hostId, terminalId, stopped.handlers)();
    const live = listener();
    store.followTerminal(hostId, terminalId, live.handlers);
    ptys.spawned[0]?.emit("x");
    await waitFor(() => live.seen.includes("data:x")).catch(() => null);
    expect(live.seen).toContain("data:x");
    expect(stopped.seen).toEqual([]);
    server.stop();
    await waitFor(() => live.seen.includes("offline")).catch(() => null);
    expect(live.seen).toContain("offline");
  });

  test("the terminals of a host that is not connected refuse", async () => {
    const { store } = await setup();
    expect(await store.terminalHost("ghost").list().catch(() => "refused")).toBe("refused");
  });
});
