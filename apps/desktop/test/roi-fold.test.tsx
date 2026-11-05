import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { en } from "../src/i18n/en.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(40_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(10_000);

/** A project's board on a host with return on cost, in a window whose storage `mem` keeps. */
async function board(mem = memoryPlatform(false, "en")) {
  const d = makeDaemon(cleanups, { roi: true });
  const repo = join(d.root, "shop");
  mkdirSync(repo, { recursive: true });
  await Bun.spawn(["git", "init", "-q", repo]).exited;
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id ?? "";
  const project = await store.hostCommand(hostId, "project.add", { path: repo });
  await act(async () => {
    store.tabs.open({ name: "board", host: hostId, projectId: project?.id ?? "" });
  });
  await settle(() => screen.queryByRole("region", { name: en.roiUi.title }) !== null);
  await settle(() => card().querySelector("p") !== null);
  return mem;
}
const card = () => screen.queryByRole("region", { name: en.roiUi.title }) as HTMLElement;
const toggle = () =>
  within(card()).queryByRole("button", { name: en.roiUi.details }) as HTMLButtonElement | null;
const period = () => within(card()).queryByRole("group", { name: en.roiUi.period });

// Issue #178: the return on cost card took the top of the board and pushed its columns below the
// fold. It opens folded to its headline; the person's choice to open it is kept.
describe("roi-fold: the return on cost card opens folded to its headline", () => {
  test("folded, the card shows its title, its headline and Show details, not the period or the figures", async () => {
    await board();
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
    expect(card().querySelector("p")?.textContent ?? "").not.toBe("");
    expect(period()).toBeNull();
  });

  test("Show details opens it, and it opens that way again on the next start", async () => {
    const mem = await board();
    expect(toggle()).not.toBeNull();
    await act(async () => {
      fireEvent.click(toggle() as HTMLButtonElement);
    });
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    expect(period()).not.toBeNull();
    cleanup();
    await board(mem);
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    expect(period()).not.toBeNull();
  });
});
