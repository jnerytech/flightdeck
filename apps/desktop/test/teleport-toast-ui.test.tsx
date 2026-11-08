import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
const {
  act,
  cleanup,
  fireEvent,
  render,
  within,
  waitFor: rtlWaitFor,
} = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { RequestError } = await import("../src/lib/host-connection.ts");
const { TeleportMove } = await import("../src/ui/TeleportMove.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

/**
 * Issue #100: the move dialog can close while the target finishes. When the move ends after that,
 * a toast says so (with a button to open the session there), or says why it was refused. While the
 * dialog is open, it tells the person itself and no toast is added.
 */
setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });

type MoveArgs = Parameters<InstanceType<typeof AppStore>["moveSession"]>[2];
type Outcome = Awaited<ReturnType<InstanceType<typeof AppStore>["moveSession"]>>;

async function setup() {
  const alfa = makeDaemon(cleanups, { teleport: true });
  const beta = makeDaemon(cleanups, { teleport: true });
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
  store.i18n.start();
  cleanups.push(() => store.dispose());
  const from = await store.addHost({ name: "alfa", url: alfa.listen().url, token: TOKEN });
  const to = await store.addHost({ name: "beta", url: beta.listen().url, token: TOKEN });
  await waitFor(() =>
    expect(store.getState().hosts.every((h) => h.status === "online")).toBe(true),
  );
  // The relay is the store's own and is tested elsewhere: here the move ends when the test says.
  const move: {
    args?: MoveArgs;
    end?: (outcome: Outcome) => void;
    fail?: (error: unknown) => void;
  } = {};
  (store as unknown as { moveSession: unknown }).moveSession = (
    _source: string,
    _session: string,
    args: MoveArgs,
  ) => {
    move.args = args;
    return new Promise<Outcome>((resolve, reject) => {
      move.end = resolve;
      move.fail = reject;
    });
  };
  let closed = 0;
  render(
    <TContext.Provider value={store.i18n.t}>
      <TeleportMove store={store} hostId={from} sessionId="s1" onClose={() => void closed++} />
    </TContext.Provider>,
  );
  const select = await waitFor(() => screen.getByRole("combobox", { name: "Host" }));
  await act(async () => {
    fireEvent.change(select, { target: { value: to } });
  });
  await act(async () => {
    fireEvent.change(screen.getByRole("textbox", { name: "Repository on that host" }), {
      target: { value: "/work/app" },
    });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  });
  await waitFor(() => expect(move.args).not.toBeUndefined());
  return { store, move, to, closed: () => closed };
}

const press = async (name: string) => {
  await waitFor(() => expect(screen.queryByRole("button", { name }) !== null).toBe(true)); // NOSONAR: not.toBeNull on a DOM element inside waitFor formats the DOM tree on each retry (docs/TDD.md)
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name }) as HTMLElement);
  });
};

/** The form's own Close, not the dialog's X. */
const closeForm = async () => {
  const status = await waitFor(() => screen.getByRole("status"));
  const form = status.closest("form") as HTMLElement;
  await act(async () => {
    fireEvent.click(within(form).getByRole("button", { name: "Close" }));
  });
};

/** The move reaches the point where the target imports: every byte is sent. */
async function reachFinishing(move: Awaited<ReturnType<typeof setup>>["move"]) {
  const summary = { branch: "feature", ahead: 0, changed: 0, bytes: 10, secretLines: 0 };
  await act(async () => {
    void move.args?.confirm(summary);
  });
  await press("Move");
  await act(async () => {
    move.args?.onProgress(10, 10);
  });
  await waitFor(() => expect(screen.queryByText(/Finishing on beta/) !== null).toBe(true)); // NOSONAR: not.toBeNull on a DOM element inside waitFor formats the DOM tree on each retry (docs/TDD.md)
}

const toasts = (store: InstanceType<typeof AppStore>) =>
  store
    .getState()
    .notices.map((n) => ({ kind: n.kind, text: n.text, link: n.link?.label ?? null }));

describe("teleport-toast: a move that ends after its dialog closed says so (#100)", () => {
  test("moved: a toast names the host and opens the session there", async () => {
    const { store, move, to, closed } = await setup();
    await reachFinishing(move);
    await closeForm();
    expect(closed()).toBe(1);
    await act(async () => {
      move.end?.({ kind: "moved", sessionId: "s2", worktree: "/work/app-2", branch: "feature" });
    });
    await waitFor(() => expect(store.getState().notices).toHaveLength(1));
    expect(toasts(store)).toEqual([
      { kind: "success", text: "The session moved to beta.", link: "Open it there" },
    ]);
    await act(async () => {
      store.getState().notices[0]?.link?.run();
    });
    expect(store.router.current).toEqual({ name: "session", host: to, id: "s2" });
  });

  test("refused: a toast with the app's own text, never the host's words", async () => {
    const { store, move } = await setup();
    await reachFinishing(move);
    await closeForm();
    await act(async () => {
      move.fail?.(new RequestError("conflict", "the host says: /etc/passwd", "teleport_too_large"));
    });
    await waitFor(() => expect(store.getState().notices).toHaveLength(1));
    const [toast] = store.getState().notices;
    expect([toast?.kind, toast?.text.includes("passwd"), (toast?.text ?? "").length > 0]).toEqual([
      "error",
      false,
      true,
    ]);
  });

  test("a move that ends while the dialog is open adds no toast: the dialog says it", async () => {
    const { store, move } = await setup();
    await reachFinishing(move);
    await act(async () => {
      move.end?.({ kind: "moved", sessionId: "s2", worktree: "/work/app-2", branch: "feature" });
    });
    await waitFor(
      () => expect(screen.queryByText(/The session is on beta now/) !== null).toBe(true), // NOSONAR: not.toBeNull on a DOM element inside waitFor formats the DOM tree on each retry (docs/TDD.md)
    );
    expect(toasts(store)).toEqual([]);
  });

  test("a move the person cancelled leaves no toast", async () => {
    const { store, move, closed } = await setup();
    await reachFinishing(move);
    await closeForm();
    await act(async () => {
      move.end?.({ kind: "cancelled" });
    });
    expect([closed(), toasts(store)]).toEqual([1, []]);
  });
});
