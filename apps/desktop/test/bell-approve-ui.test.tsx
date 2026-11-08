import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settleMaybe, stays } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { requestLink } = await import("../src/lib/request-link.ts");

const stores: Array<{ dispose(): void }> = [];
afterEach(() => {
  cleanup();
  for (const s of stores.splice(0)) s.dispose();
});

type Pending = {
  requestId: string;
  toolName: string;
  createdAt: string;
  risk?: string;
  input?: object;
};
const request = (over: Partial<Pending> = {}): Pending => ({
  requestId: "r1",
  toolName: "Bash",
  createdAt: "2026-11-04T13:00:00Z",
  input: { command: "npm test" },
  risk: "low",
  ...over,
});

/** The inbox entry the app keeps for a request: its link, and the plain words about it. */
const entry = (requestId: string, over: Record<string, unknown> = {}) => ({
  id: `e-${requestId}`,
  at: new Date().toISOString(),
  title: "Needs you",
  body: "alfa · Bash",
  link: requestLink("h", requestId),
  subject: "Backend tests",
  host: "alfa",
  ask: "Wants to run: npm test",
  read: false,
  ...over,
});

async function setup(
  options: {
    lang?: "en" | "pt-BR";
    pending?: Pending[];
    entries?: ReturnType<typeof entry>[];
    status?: "online" | "offline";
  } = {},
) {
  const phone = memoryPlatform(false, options.lang ?? "en");
  const entries = options.entries ?? [entry("r1")];
  phone.items.set("flightdeck.inbox", JSON.stringify(entries));
  const store = new AppStore(phone.platform, { baseDelayMs: 60_000 });
  stores.push(store);
  const answered: Array<[string, string, string, unknown]> = [];
  const patch = (pending: Pending[]) =>
    (store as unknown as { update(patch: object): void }).update({
      hosts: [
        {
          id: "h",
          name: "alfa",
          status: options.status ?? "online",
          sessions: [
            {
              id: "s1",
              name: "Backend tests",
              cwd: "/p",
              status: "idle",
              pendingPermissions: pending,
            },
          ],
        },
      ],
    });
  // A host answers by dropping the request from what waits.
  let waiting = options.pending ?? [request()];
  store.respondTo = (async (host: string, id: string, decision: string, answer: unknown) => {
    answered.push([host, id, decision, answer]);
    waiting = waiting.filter((p) => p.requestId !== id);
    await act(async () => patch(waiting));
  }) as never;
  store.refreshHub = (async () => {}) as never;
  render(<App store={store} />);
  await act(async () => patch(waiting));
  return { store, answered };
}

const bell = () => screen.queryByRole("button", { name: /^(Notifications|Notificações)/ });
const open = async () => {
  await settleMaybe(() => bell() !== null);
  await act(async () => {
    fireEvent.click(bell() as HTMLElement);
  });
  await settleMaybe(() => screen.queryByRole("dialog") !== null);
  return screen.getByRole("dialog");
};
const panelButton = (name: string | RegExp) =>
  within(screen.getByRole("dialog")).queryByRole("button", { name });
const press = async (name: string | RegExp) => {
  const button = panelButton(name);
  expect(button === null).toBe(false);
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
const rowCount = () => within(screen.getByRole("dialog")).queryAllByRole("listitem").length;

describe("bell-approve-ui: a request is answered from the bell (#1131)", () => {
  test("a waiting request shows its risk chip and Approve and Deny; Approve answers it and the row leaves", async () => {
    const { answered } = await setup();
    await open();
    expect(within(screen.getByRole("dialog")).queryByText("Low risk") === null).toBe(false);
    expect([panelButton("Approve") === null, panelButton("Deny") === null]).toEqual([false, false]);
    await press("Approve");
    expect(answered).toEqual([["h", "r1", "allow", { held: false }]]);
    expect(await settleMaybe(() => rowCount() === 0)).toBe(true);
    expect(bell()?.getAttribute("aria-label")).toBe("Notifications");
  });

  test("Deny answers it the same way", async () => {
    const { answered } = await setup();
    await open();
    await press("Deny");
    expect(answered).toEqual([["h", "r1", "deny", {}]]);
    expect(await settleMaybe(() => rowCount() === 0)).toBe(true);
  });

  test("A and N on the row answer it, as in Needs you", async () => {
    const first = await setup();
    await open();
    const pick = () => panelButton(/Backend tests/) as HTMLElement;
    await act(async () => {
      fireEvent.keyDown(pick(), { key: "a" });
    });
    expect(first.answered.map(([, , decision]) => decision)).toEqual(["allow"]);
    cleanup();
    const second = await setup();
    await open();
    await act(async () => {
      fireEvent.keyDown(pick(), { key: "N" });
    });
    expect(second.answered.map(([, , decision]) => decision)).toEqual(["deny"]);
  });

  test("a high-risk request is approved by holding the button, never by A", async () => {
    const { answered } = await setup({ pending: [request({ risk: "high" })] });
    await open();
    expect(within(screen.getByRole("dialog")).queryByText("High risk") === null).toBe(false);
    expect(panelButton("Approve") === null).toBe(true);
    expect(panelButton(/Hold to approve/) === null).toBe(false);
    await act(async () => {
      fireEvent.keyDown(panelButton(/Backend tests/) as HTMLElement, { key: "a" });
    });
    await stays(() => answered.length === 0);
    // N still denies a high-risk request.
    await act(async () => {
      fireEvent.keyDown(panelButton(/Backend tests/) as HTMLElement, { key: "n" });
    });
    expect(answered.map(([, , decision]) => decision)).toEqual(["deny"]);
  });

  test("a question and a plan are not answered from the row", async () => {
    await setup({
      pending: [
        request({ toolName: "AskUserQuestion" }),
        request({ requestId: "r2", toolName: "ExitPlanMode" }),
      ],
      entries: [entry("r1"), entry("r2", { subject: "Plan session" })],
    });
    await open();
    expect([panelButton("Approve") === null, panelButton("Deny") === null]).toEqual([true, true]);
    expect(rowCount()).toBe(2);
  });

  test("a request that was answered elsewhere is not in the bell, nor in its count", async () => {
    await setup({ pending: [], entries: [entry("r1")] });
    await open();
    expect(rowCount()).toBe(0);
    expect(bell()?.getAttribute("aria-label")).toBe("Notifications");
  });

  test("while the host is offline its requests stay listed: nothing says they were answered", async () => {
    await setup({ pending: [], entries: [entry("r1")], status: "offline" });
    await open();
    expect(rowCount()).toBe(1);
  });

  test("after an answer the focus stays in the panel: on the row that took its place, or the title", async () => {
    await setup({
      pending: [request(), request({ requestId: "r2" })],
      entries: [
        entry("r1", { at: new Date(Date.now() - 1000).toISOString() }),
        entry("r2", { subject: "Second session" }),
      ],
    });
    await open();
    const row = (name: RegExp) => panelButton(name) as HTMLElement;
    // The newest entry is first: answer it with the keyboard on its row.
    row(/Second session/).focus();
    await act(async () => {
      fireEvent.keyDown(row(/Second session/), { key: "a" });
    });
    expect(await settleMaybe(() => document.activeElement === panelButton(/Backend tests/))).toBe(
      true,
    );
    await act(async () => {
      fireEvent.keyDown(row(/Backend tests/), { key: "n" });
    });
    const title = within(screen.getByRole("dialog")).getByRole("heading", {
      name: "Notifications",
    });
    expect(await settleMaybe(() => document.activeElement === title)).toBe(true);
  });

  test("in Portuguese the chip, the buttons and the keys are in Portuguese", async () => {
    const { answered } = await setup({ lang: "pt-BR" });
    await open();
    expect(within(screen.getByRole("dialog")).queryByText("Risco baixo") === null).toBe(false);
    await press("Aprovar");
    expect(answered.map(([, , decision]) => decision)).toEqual(["allow"]);
  });
});

describe("bell-approve-ui: a click on the OS notification opens that request (#1131)", () => {
  test("its link opens the session with the focus on that request", async () => {
    const { store } = await setup({
      pending: [request(), request({ requestId: "r2" })],
      entries: [entry("r1"), entry("r2")],
    });
    await act(async () => {
      store.openRequestLink(requestLink("h", "r2"));
    });
    expect(
      await settleMaybe(() => {
        const route = store.router.current;
        return route.name === "session" && route.focus === "r2";
      }),
    ).toBe(true);
  });
});
