import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../../src/i18n/en.ts";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");

afterEach(() => cleanup());

/** Issue #1751: a terminal session at a plan is listed, and the app can only open it. */
async function planWaiting() {
  const store = new AppStore(memoryPlatform(false, "en").platform);
  render(<App store={store} />);
  await act(async () => {
    store.router.push({ name: "needs-you" });
    (store as unknown as { update(patch: object): void }).update({
      hosts: [{ id: "h", name: "alfa", status: "online", sessions: [] }],
      externals: {
        "h/c1": {
          claudeSessionId: "c1",
          cwd: "/w/app",
          transcriptPath: null,
          source: null,
          status: "idle",
          statusReason: null,
          launchId: null,
          controllable: false,
          projectKey: null,
          startedAt: "2026-11-10T11:00:00Z",
          lastEventAt: "2026-11-10T11:57:00Z",
          endedAt: null,
          waiting: "plan",
        },
      },
    });
  });
  return store;
}

const buttons = () => [...document.querySelectorAll("main button")];
const labels = () => buttons().map((b) => b.textContent ?? "");

describe("needs-you-terminal-wait-ui: a plan waiting in the terminal (#1751)", () => {
  test("Given a terminal session at a plan, Then its row says what it waits for", async () => {
    await planWaiting();
    const rows = [...document.querySelectorAll("main li button")].map(
      (b) => b.getAttribute("aria-label") ?? "",
    );
    expect(rows).toEqual([`alfa · app: ${en.hub.rowDetail.waiting.plan}`]);
  });

  test("Given the row is chosen, Then the details offer to open the session and no approve or deny", async () => {
    await planWaiting();
    const row = document.querySelector("main li button") as HTMLElement | null;
    await act(async () => {
      if (row) fireEvent.click(row);
    });
    const text = labels();
    expect([
      text.includes(en.approval.openSession),
      text.some((label) => /approve|keep planning|deny/i.test(label)),
    ]).toEqual([true, false]);
  });
});
