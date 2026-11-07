import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { createWebPlatform } from "../src/platform/web/index.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore, sessionKey } = await import("../src/lib/app-store.ts");
const { hubRows } = await import("../src/lib/hub.ts");
const { useStoreState } = await import("../src/lib/use-store.ts");
const { SessionTiles } = await import("../src/components/projects/session-tiles.tsx");
const { ApprovalCard } = await import("../src/components/approval/approval-card.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** The elements Tab stops on, in document order, each named as a screen reader would. */
function tabStops(root: HTMLElement): string[] {
  const inside = root.querySelectorAll<HTMLElement>(
    "button, input, textarea, select, a[href], [tabindex]",
  );
  return [root, ...Array.from(inside)]
    .filter((el) => !(el as HTMLButtonElement).disabled && el.tabIndex >= 0)
    .map((el) => `${el.tagName.toLowerCase()}:${el.getAttribute("aria-label") ?? el.textContent}`);
}

describe("sonar-a11y4: the web build refuses the API assistant with a real Error", () => {
  test("setKey, test and run reject with an Error whose message and reason are the refusal", async () => {
    const assistant = createWebPlatform({} as never).assistant;
    const request = {} as never;
    const options = { provider: "anthropic", denyDataCollection: true } as never;
    const rejections = await Promise.all(
      [
        () => assistant.setKey("anthropic", "k"),
        () => assistant.test("anthropic"),
        () => assistant.run(request, [], options),
      ].map((call) =>
        call().then(
          () => null,
          (e: unknown) => e,
        ),
      ),
    );
    expect(rejections.map((e) => e instanceof Error)).toEqual([true, true, true]);
    expect(rejections.map((e) => (e as Error).message)).toEqual([
      "assistant_not_configured",
      "assistant_not_configured",
      "assistant_not_configured",
    ]);
    expect(rejections.map((e) => (e as { reason?: string }).reason)).toEqual([
      "assistant_not_configured",
      "assistant_not_configured",
      "assistant_not_configured",
    ]);
  });
});

/** The tiles on the app's live state, as the project page has them. */
function Live(props: {
  store: InstanceType<typeof AppStore>;
  hostId: string;
  projectKey: string;
  onOpen(row: { sessionId: string | null }): void;
}) {
  const state = useStoreState(props.store);
  return (
    <TContext.Provider value={props.store.i18n.t}>
      <SessionTiles
        store={props.store}
        state={state}
        hostId={props.hostId}
        projectKey={props.projectKey}
        onOpen={props.onOpen as never}
      />
    </TContext.Provider>
  );
}

/** A host with `names.length` sessions of one folder, the first one asking for a permission. */
async function tiles(names: string[]) {
  const d = makeDaemon(cleanups);
  const server = d.listen();
  const mem = memoryPlatform(false, "en");
  const store = new AppStore(mem.platform, { baseDelayMs: 10, maxDelayMs: 20 });
  cleanups.push(() => store.dispose());
  store.i18n.start();
  const hostId = await store.addHost({ name: "pc", url: server.url, token: TOKEN });
  await waitFor(() => store.getState().hosts.find((h) => h.id === hostId)?.status === "online");
  const ids: string[] = [];
  for (const [at, name] of names.entries()) {
    const id = (await store.createSession(hostId, {
      cwd: d.project,
      prompt: at === 0 ? "[tool]" : `oi ${name}`,
      name,
    })) as string;
    ids.push(id);
    await waitFor(() => store.getState().sessions[sessionKey(hostId, id)]?.status !== undefined);
  }
  store.select(hostId, null);
  await store.refreshHub();
  const projectKey = hubRows(store.getState())[0]?.projectKey as string;
  const opened: string[] = [];
  render(
    <Live
      store={store}
      hostId={hostId}
      projectKey={projectKey}
      onOpen={(row) => void opened.push(row.sessionId as string)}
    />,
  );
  await waitFor(() => document.querySelectorAll("[data-slot='session-tile']").length >= 1);
  return { store, hostId, ids, opened };
}

const tileEls = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-slot='session-tile']"));

/** Puts `streaming` text into a session, as live deltas would. */
async function stream(
  store: InstanceType<typeof AppStore>,
  hostId: string,
  id: string,
  text: string,
) {
  await act(async () => {
    const state = store.getState();
    const key = sessionKey(hostId, id);
    const session = state.sessions[key];
    if (!session) return;
    (store as unknown as { update(patch: object): void }).update({
      sessions: { ...state.sessions, [key]: { ...session, streaming: text } },
    });
  });
}

const linesOf = (tile: HTMLElement) =>
  Array.from(within(tile).getByLabelText("Last lines").children) as HTMLElement[];

describe("sonar-a11y4: a session tile keeps its roles, names, keys and click targets", () => {
  test("the tile is a named region that is a tab stop, with the Open button, the message box and the grid around it", async () => {
    await tiles(["um", "dois"]);
    await waitFor(() => tileEls().length === 2, "two tiles");
    expect(screen.getByRole("list", { name: "Sessions side by side" })).toBeTruthy();
    const um = screen.getByRole("region", { name: "um" });
    expect(um.getAttribute("data-slot")).toBe("session-tile");
    expect(um.tabIndex).toBe(0);
    expect(um.getAttribute("aria-keyshortcuts")).toBe(
      "Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown",
    );
    expect(within(um).getByRole("button", { name: "Open um" })).toBeTruthy();
    expect(within(um).getByRole("textbox", { name: "Message to um" })).toBeTruthy();
    expect(within(um).getByLabelText("Last lines").tagName).toBe("OUTPUT");
  });

  test("Tab goes tile, Open, the request's Approve and Deny, then the message box; the next tile follows", async () => {
    await tiles(["pede", "quieta"]);
    await waitFor(
      () => tileEls().length === 2 && tileEls()[0]?.getAttribute("aria-label") === "pede",
    );
    const first = tileEls()[0] as HTMLElement;
    await waitFor(() => within(first).queryByRole("group", { name: "Request" }) !== null);
    const stops = tabStops(first);
    expect(stops.slice(0, 5)).toEqual([
      "section:pede",
      "button:Open pede",
      "button:Approve",
      "button:Deny",
      "textarea:Message to pede",
    ]);
    expect(tabStops(tileEls()[1] as HTMLElement)).toEqual([
      "section:quieta",
      "button:Open quieta",
      "textarea:Message to quieta",
    ]);
  });

  test("Alt+arrows from the tile or from a field inside it move focus to a neighbouring tile; other keys do not", async () => {
    await tiles(["a", "b", "c", "d"]);
    await waitFor(() => tileEls().length === 4, "four tiles");
    const all = tileEls();
    all[0]?.focus();
    expect(document.activeElement === all[0]).toBe(true);
    await act(async () => {
      fireEvent.keyDown(all[0] as HTMLElement, { key: "ArrowRight", altKey: true });
    });
    expect(document.activeElement === all[1]).toBe(true);
    const box = within(all[1] as HTMLElement).getByRole("textbox");
    box.focus();
    await act(async () => {
      fireEvent.keyDown(box, { key: "ArrowDown", altKey: true });
    });
    expect(document.activeElement === all[3]).toBe(true);
    const open = within(all[3] as HTMLElement).getByRole("button", { name: /^Open / });
    await act(async () => {
      fireEvent.keyDown(open, { key: "ArrowLeft", altKey: true });
    });
    expect(document.activeElement === all[2]).toBe(true);
    // No Alt, an unrelated key and the edge of the grid leave the focus where it is.
    await act(async () => {
      fireEvent.keyDown(all[2] as HTMLElement, { key: "ArrowRight" });
      fireEvent.keyDown(all[2] as HTMLElement, { key: "x", altKey: true });
      fireEvent.keyDown(all[2] as HTMLElement, { key: "ArrowDown", altKey: true });
    });
    expect(document.activeElement === all[2]).toBe(true);
  });

  test("clicking Open opens that session, clicking the tile itself opens nothing, Approve answers without opening", async () => {
    const { opened, ids } = await tiles(["pede", "quieta"]);
    await waitFor(
      () => tileEls().length === 2 && tileEls()[0]?.getAttribute("aria-label") === "pede",
    );
    const first = tileEls()[0] as HTMLElement;
    await act(async () => {
      fireEvent.click(first);
    });
    expect(opened).toEqual([]);
    await act(async () => {
      fireEvent.click(within(first).getByRole("button", { name: "Open pede" }));
    });
    expect(opened).toHaveLength(1);
    expect(ids).toContain(opened[0] as string);
    await waitFor(() => within(first).queryByRole("button", { name: "Approve" }) !== null);
    await act(async () => {
      fireEvent.click(within(first).getByRole("button", { name: "Approve" }));
    });
    expect(opened).toHaveLength(1);
  });

  test("a line that stays in the tail keeps its element as the tail moves, and repeated lines all show", async () => {
    const errors = spyOn(console, "error").mockImplementation(() => {});
    const { store, hostId, ids } = await tiles(["pede", "solo"]);
    await waitFor(() => tileEls().length === 2, "two tiles");
    const tile = screen.getByRole("region", { name: "solo" });
    // Its own reply is done first: a later event would replace the text put there.
    await waitFor(
      () =>
        (within(tile).queryByLabelText("Last lines")?.textContent ?? "").includes("Echo: oi solo"),
      "its reply",
    );
    await waitFor(
      () => store.getState().sessions[sessionKey(hostId, ids[1] as string)]?.status === "idle",
      "idle",
    );
    await stream(store, hostId, ids[1] as string, "one\ntwo\nthree\nfour");
    await waitFor(() => linesOf(tile).length === 4, "four lines");
    expect(linesOf(tile).map((l) => l.textContent)).toEqual(["one", "two", "three", "four"]);
    const three = linesOf(tile)[2] as HTMLElement;
    await stream(store, hostId, ids[1] as string, "two\nthree\nfour\nfive");
    await waitFor(() => linesOf(tile)[3]?.textContent === "five", "tail moved");
    expect(linesOf(tile).map((l) => l.textContent)).toEqual(["two", "three", "four", "five"]);
    expect(linesOf(tile)[1] === three).toBe(true);
    await stream(store, hostId, ids[1] as string, "same\nsame\nsame");
    await waitFor(() => linesOf(tile).length === 3, "repeated lines");
    expect(linesOf(tile).map((l) => l.textContent)).toEqual(["same", "same", "same"]);
    expect(errors.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("key"))).toEqual([]);
    errors.mockRestore();
  });
});

const T = translator("en");
const AT = "2026-10-29T12:00:00.000Z";
const NOW = Date.parse(AT) + 60_000;

type Respond = (...args: unknown[]) => unknown;

function card(over: {
  request?: Record<string, unknown>;
  onRespond?: Respond;
  resolution?: { decision: "allow" | "deny" };
}) {
  const calls: unknown[][] = [];
  const request = {
    requestId: "r1",
    toolName: "Bash",
    input: { command: "npm test" },
    cwd: "/repo",
    createdAt: AT,
    ...over.request,
  };
  const element = (req: typeof request) => (
    <TContext.Provider value={T}>
      <ApprovalCard
        request={req}
        t={T}
        nowMs={NOW}
        {...(over.resolution ? { resolution: over.resolution } : {})}
        onRespond={(...args: unknown[]) => {
          calls.push(args);
          return over.onRespond?.(...args);
        }}
      />
    </TContext.Provider>
  );
  const view = render(element(request));
  return {
    calls,
    rerender: (next: Record<string, unknown>) => view.rerender(element({ ...request, ...next })),
  };
}

const group = (tool = "Bash") => screen.getByRole("group", { name: `Request for ${tool}` });

describe("sonar-a11y4: the approval card keeps its roles, names, keys and focus order", () => {
  test("the card is a named group and a tab stop; Tab goes card, Approve, Deny, and the hint names the keys", () => {
    card({});
    const g = group();
    expect(g.tagName).toBe("FIELDSET");
    expect(g.tabIndex).toBe(0);
    expect(g.getAttribute("data-slot")).toBe("approval-card");
    expect(g.getAttribute("data-request-id")).toBe("r1");
    expect(tabStops(g)).toEqual(["fieldset:Request for Bash", "button:Approve", "button:Deny"]);
    expect(within(g).getByText(T("approval.keys"))).toBeTruthy();
  });

  test("a plain A on the focused card approves, N opens the reason and focuses it, Esc leaves the card", async () => {
    const { calls } = card({});
    const g = group();
    g.focus();
    expect(document.activeElement === g).toBe(true);
    await act(async () => {
      fireEvent.keyDown(g, { key: "Escape" });
    });
    expect(document.activeElement === g).toBe(false);
    await act(async () => {
      fireEvent.keyDown(g, { key: "n" });
    });
    const reason = within(g).getByRole("textbox", { name: "Reason (optional)" });
    expect(document.activeElement === reason).toBe(true);
    expect(tabStops(g)).toEqual([
      "fieldset:Request for Bash",
      "input:Reason (optional)",
      "button:Deny",
      "button:Cancel",
    ]);
    expect(calls).toEqual([]);
    await act(async () => {
      fireEvent.click(within(g).getByRole("button", { name: "Cancel" }));
    });
    await act(async () => {
      fireEvent.keyDown(g, { key: "A" });
    });
    expect(calls).toEqual([["allow"]]);
  });

  test("keys that come from a button or the reason field inside the card are text, not shortcuts", async () => {
    const { calls } = card({});
    const g = group();
    await act(async () => {
      fireEvent.keyDown(within(g).getByRole("button", { name: "Approve" }), { key: "n" });
    });
    expect(within(g).queryByRole("textbox", { name: "Reason (optional)" })).toBeNull();
    await act(async () => {
      fireEvent.keyDown(g, { key: "n" });
    });
    const reason = within(g).getByRole("textbox", { name: "Reason (optional)" });
    await act(async () => {
      fireEvent.keyDown(reason, { key: "a" });
      fireEvent.keyDown(reason, { key: "Escape" });
    });
    expect(calls).toEqual([]);
    expect(within(g).getByRole("textbox", { name: "Reason (optional)" })).toBeTruthy();
  });

  test("a high-risk request is never approved by a key, a settled one answers no key, and a question takes no A", async () => {
    const high = card({ request: { risk: "high", riskReason: "Deletes things" } });
    await act(async () => {
      fireEvent.keyDown(group(), { key: "a" });
    });
    expect(high.calls).toEqual([]);
    expect(within(group()).getByText(T("approval.keysHigh"))).toBeTruthy();
    cleanup();
    const settled = card({ resolution: { decision: "allow" } });
    await act(async () => {
      fireEvent.keyDown(group(), { key: "a" });
      fireEvent.keyDown(group(), { key: "n" });
    });
    expect(settled.calls).toEqual([]);
    expect(within(group()).queryByRole("textbox", { name: "Reason (optional)" })).toBeNull();
    cleanup();
    const ask = card({
      request: {
        toolName: "AskUserQuestion",
        input: { questions: [{ question: "Which?", header: "Pick", options: [] }] },
      },
    });
    await act(async () => {
      fireEvent.keyDown(group("AskUserQuestion"), { key: "a" });
    });
    expect(ask.calls).toEqual([]);
  });

  test("while an answer is on its way the card takes no second key", async () => {
    const { calls } = card({ onRespond: () => new Promise<void>(() => {}) });
    await act(async () => {
      fireEvent.keyDown(group(), { key: "a" });
    });
    await act(async () => {
      fireEvent.keyDown(group(), { key: "a" });
    });
    expect(calls).toEqual([["allow"]]);
  });

  test("Approve and Deny are the click targets: Approve answers, Deny opens the reason", async () => {
    const { calls } = card({});
    await act(async () => {
      fireEvent.click(within(group()).getByRole("button", { name: "Deny" }));
    });
    expect(within(group()).getByRole("textbox", { name: "Reason (optional)" })).toBeTruthy();
    expect(calls).toEqual([]);
    await act(async () => {
      fireEvent.click(within(group()).getByRole("button", { name: "Deny" }));
    });
    expect(calls).toEqual([["deny"]]);
  });

  const diffLines = (g: HTMLElement) =>
    Array.from(g.querySelectorAll<HTMLElement>("pre > div")).filter((d) => d.textContent !== "…");

  test("a diff line that stays keeps its element when the preview changes, and repeated lines all show", () => {
    const errors = spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = card({
      request: { toolName: "Write", input: { file_path: "/repo/a.txt", content: "a\nb\nc" } },
    });
    const g = group("Write");
    expect(diffLines(g).map((d) => d.textContent)).toEqual(["+ a", "+ b", "+ c"]);
    const b = diffLines(g)[1] as HTMLElement;
    rerender({ input: { file_path: "/repo/a.txt", content: "b\nc\nd" } });
    expect(diffLines(g).map((d) => d.textContent)).toEqual(["+ b", "+ c", "+ d"]);
    expect(diffLines(g)[0] === b).toBe(true);
    rerender({ input: { file_path: "/repo/a.txt", content: "x\nx\nx" } });
    expect(diffLines(g).map((d) => d.textContent)).toEqual(["+ x", "+ x", "+ x"]);
    expect(errors.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("key"))).toEqual([]);
    errors.mockRestore();
  });
});
