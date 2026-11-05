import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(60_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(15_000);

describe("trust-notice-session: the session screen offers the review of its project (#196)", () => {
  test("a session in an untrusted project folder says so, and Review and trust opens the project page", async () => {
    const d = makeDaemon(cleanups, { trust: true });
    const repo = join(d.root, "shop");
    mkdirSync(repo, { recursive: true });
    await Bun.spawn(["git", "init", "-q", repo]).exited;
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    const hostId = store.getState().hosts[0]?.id ?? "";
    const project = await store.hostCommand(hostId, "project.add", { path: repo });
    await act(async () => {
      await store.loadProjects(hostId);
    });
    const { sessionId } = await d.manager.create({ cwd: repo, prompt: "hello" });
    await act(async () => {
      store.router.push({ name: "session", host: hostId, id: sessionId });
    });
    await settle(() => screen.queryByRole("button", { name: "Review and trust" }) !== null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review and trust" }));
    });
    const route = store.router.current;
    expect(route.name).toBe("project");
    expect((route as { projectId?: string }).projectId).toBe(project?.id);
  });
});
