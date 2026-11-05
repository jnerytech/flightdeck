import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { RiskClassifier } from "../../daemon/src/permissions/risk.ts";
import { poll } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore, needsYou } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(6000);

/** The user's `risk.extraHigh` makes the fake runtime's `npm test --silent` a high-risk Bash. */
const highRisk = (root: string) =>
  new RiskClassifier({ allowedRoots: [root], home: root, extraHigh: ["npm test"] });

/** The app, not focused, on a host whose sessions `names` each wait for a Bash. */
async function waiting(names: string[], opts: { high?: boolean } = {}) {
  const d = makeDaemon(cleanups, opts.high ? { risk: highRisk } : {});
  const mem = memoryPlatform(false);
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const ids: string[] = [];
  for (const name of names) {
    const { sessionId } = await d.manager.create({ cwd: d.project, prompt: "[bash]", name });
    await poll(() => d.manager.pendingPermissions(sessionId).length === 1);
    ids.push(sessionId);
  }
  await settle(() => needsYou(store.getState()).length === names.length);
  return { d, mem, store, ids };
}

/** The request card that has the keyboard focus, by its request id ("" when none has it). */
const focusedRequest = () =>
  document.activeElement?.closest("[data-request-id]")?.getAttribute("data-request-id") ?? "";

const press = async (key: string) => {
  await act(async () => {
    fireEvent.keyDown(document.activeElement as Element, { key });
  });
};

// Issue #187 (J4): answering a request took a click on its card before A or N did anything.
describe("journey-answer: a request is answered from where it was announced", () => {
  test("from the notification, the request's card has the focus, so A answers it at once", async () => {
    const { d, mem, store, ids } = await waiting(["Pedinte"]);
    const [item] = needsYou(store.getState());
    await act(async () => mem.shown.at(-1)?.onclick?.());
    await settle(() => focusedRequest() === item?.requestId, 6000, "the card has the focus");
    await press("a");
    await poll(() => d.manager.pendingPermissions(ids[0] as string).length === 0);
    expect(d.manager.pendingPermissions(ids[0] as string)).toEqual([]);
  });

  test("a high-risk request gets the focus too, but A does not approve it: it is held", async () => {
    const { d, mem, store, ids } = await waiting(["Arriscado"], { high: true });
    const [item] = needsYou(store.getState());
    await act(async () => mem.shown.at(-1)?.onclick?.());
    await settle(() => focusedRequest() === item?.requestId, 6000, "the card has the focus");
    await press("a");
    await Bun.sleep(200);
    expect(d.manager.pendingPermissions(ids[0] as string).length).toBe(1);
  });

  test("Needs you goes on to the next request once one is answered, focused, and says how many are left", async () => {
    const { store } = await waiting(["Primeira", "Segunda"]);
    const [first, second] = needsYou(store.getState());
    await sidebar.queueItem(/^alfa · Primeira:/);
    await settle(() => focusedRequest() === first?.requestId, 6000, "the first card has the focus");
    expect(document.body.textContent ?? "").toContain("Restam 2");
    await press("a");
    await settle(() => focusedRequest() === second?.requestId, 6000, "the next card has the focus");
    expect(document.body.textContent ?? "").toContain("Resta 1");
  });

  test("the bell's entry of a request already answered opens its session at that request", async () => {
    const { store, ids } = await waiting(["Respondida"]);
    const [item] = needsYou(store.getState());
    const hostId = item?.hostId ?? "";
    expect(store.getState().inbox[0]?.route).toEqual({
      name: "session",
      host: hostId,
      id: ids[0] as string,
      focus: item?.requestId as string,
    });
    await store.respondTo(hostId, item?.requestId ?? "", "deny");
    await settle(() => needsYou(store.getState()).length === 0);
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: /^Notificações/ }) as HTMLElement);
    });
    const entry = document.querySelector(".inbox-pick") as HTMLElement | null;
    expect(entry).not.toBeNull();
    await act(async () => {
      fireEvent.click(entry as HTMLElement);
    });
    await settle(() => screen.queryByRole("heading", { name: "Respondida" }) !== null);
    expect(screen.queryByRole("heading", { name: "Respondida" })).not.toBeNull();
  });
});
