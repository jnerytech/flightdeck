import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle, uiIdle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { SessionsHub } = await import("../../src/features/sessions/sessions-hub.tsx");
const { TooltipProvider } = await import("../../src/components/ui/tooltip.tsx");

setDefaultTimeout(60_000);
afterEach(cleanup);

type Store = InstanceType<typeof AppStore>;
type State = ReturnType<Store["getState"]>;

/** The timers of the store, recorded: a test runs the one it wants. */
function fakeTimers() {
  const pending = new Map<number, { fn: () => void; ms: number }>();
  const cleared: number[] = [];
  let next = 1;
  return {
    pending,
    cleared,
    options: {
      setTimeout: (fn: () => void, ms: number): unknown => {
        const id = next++;
        pending.set(id, {
          fn: () => {
            pending.delete(id);
            fn();
          },
          ms,
        });
        return id;
      },
      clearTimeout: (id: unknown) => {
        cleared.push(id as number);
        pending.delete(id as number);
      },
    },
  };
}

/** One online host and `n` history sessions in one project; `features` is what the host offers. */
function stateWith(store: Store, n: number, features: string[] = []) {
  const host = {
    id: "h1",
    name: "h1",
    url: "ws://x",
    token: "",
    status: "online",
    info: null,
    hostInfo: { features },
    incompatibility: null,
    daemonUpdate: null,
    sessions: [],
  };
  const history = Array.from({ length: n }, (_, i) => ({
    claudeSessionId: `c${i}`,
    cwd: "/work/p",
    projectKey: "host:h1:/work/p",
    title: `session ${i}`,
    summary: null,
    lastTs: new Date(1_700_000_000_000 + i * 1000).toISOString(),
    firstTs: null,
    messageCount: 3,
  }));
  return {
    ...store.getState(),
    hosts: [host],
    hub: { h1: { managed: [], history } },
  } as never as State;
}

function mount(store: Store, state: State, onOpen: (title: string) => void = () => {}) {
  return render(
    <TooltipProvider>
      <SessionsHub
        store={store}
        state={state}
        onOpen={(row) => onOpen(row.title)}
        isOpen={() => false}
        density="comfortable"
      />
    </TooltipProvider>,
  );
}

/** History-only projects start folded: a search matching every title opens them. */
async function openAll() {
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Filtrar sessões"), { target: { value: "session" } });
  });
  await uiIdle();
  await settle(() => document.querySelectorAll("li[aria-label]").length > 0);
}

const active = () =>
  [...document.querySelectorAll("li[data-active='true']")].map(
    (li) => li.getAttribute("aria-label") ?? "",
  );
const key = async (k: string, target: Element = document.body) => {
  await act(async () => {
    fireEvent.keyDown(target, { key: k });
  });
};

describe("hub-keys: the keyboard walks the list", () => {
  test("J and K move the mark, Enter opens the marked row, a focused button keeps its Enter", async () => {
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 600_000 });
    const opened: string[] = [];
    mount(store, stateWith(store, 3), (title) => opened.push(title));
    await openAll();
    expect(active()).toEqual([]);
    await key("j");
    const first = active();
    expect(first).toHaveLength(1);
    await key("j");
    const second = active();
    expect(second).toHaveLength(1);
    expect(second).not.toEqual(first);
    await key("k");
    expect(active()).toEqual(first);
    await key("Enter");
    expect(opened).toEqual(first);
    await key("Enter", screen.getByLabelText("Filtrar sessões"));
    expect(opened).toEqual(first);
    const button = document.createElement("button");
    document.body.appendChild(button);
    await key("Enter", button);
    expect(opened).toEqual(first);
    await key("j", button);
    expect(active()).not.toEqual(first);
  });

  test("a modified J, or J typed in the filter field, moves nothing", async () => {
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 600_000 });
    mount(store, stateWith(store, 3));
    await openAll();
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "j", ctrlKey: true });
    });
    await key("j", screen.getByLabelText("Filtrar sessões"));
    expect(active()).toEqual([]);
  });
});

describe("hub-keys: a host with background sessions is asked again every 10 s", () => {
  test("the hub schedules the next ask after each one, and stops when it closes", async () => {
    const timers = fakeTimers();
    const store = new AppStore(memoryPlatform().platform, {
      baseDelayMs: 600_000,
      timers: timers.options,
    });
    let refreshed = 0;
    store.sessionLists.refresh = async () => {
      refreshed++;
    };
    const view = mount(store, stateWith(store, 1, ["bg"]));
    await uiIdle();
    const scheduled = () => [...timers.pending.values()].filter((t) => t.ms === 10_000);
    expect(scheduled()).toHaveLength(1);
    const before = refreshed;
    await act(async () => {
      scheduled()[0]?.fn();
    });
    await uiIdle();
    expect(refreshed).toBe(before + 1);
    expect(scheduled()).toHaveLength(1);
    view.unmount();
    expect(scheduled()).toHaveLength(0);
  });

  test("a host without background sessions schedules nothing", async () => {
    const timers = fakeTimers();
    const store = new AppStore(memoryPlatform().platform, {
      baseDelayMs: 600_000,
      timers: timers.options,
    });
    store.sessionLists.refresh = async () => {};
    mount(store, stateWith(store, 1));
    await uiIdle();
    expect([...timers.pending.values()].filter((t) => t.ms === 10_000)).toHaveLength(0);
  });
});
