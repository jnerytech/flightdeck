import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { hubRows } from "../src/lib/hub.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { SessionsHub } = await import("../src/ui/SessionsHub.tsx");
const { SleepSetting } = await import("../src/components/hosts/sleep-setting.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const host = (minutes?: number) => ({
  id: "h1",
  name: "alfa",
  url: "ws://x",
  token: "",
  status: "online",
  info: null,
  hostInfo: {
    daemonVersion: "x",
    features: [],
    ...(minutes === undefined ? {} : { sleepAfterMinutes: minutes }),
  },
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
});

const session = (id: string, status: string, over: object = {}) => ({
  id,
  name: id,
  cwd: `/work/${id}`,
  status,
  permissionMode: "default",
  model: null,
  claudeSessionId: `c-${id}`,
  lastSeq: 1,
  createdAt: "2026-11-05T10:00:00Z",
  updatedAt: "2026-11-05T10:00:00Z",
  projectKey: `host:alfa:/work/${id}`,
  ...over,
});

function setup(
  sessions = [
    session("awake", "idle", { asleep: false }),
    session("sleeper", "idle", { asleep: true }),
    session("busy", "running", { asleep: false }),
  ],
) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const asked: Array<[string, unknown]> = [];
  store.hostCommand = (async (_h: string, type: string, payload: unknown) => {
    asked.push([type, payload]);
    return type === "session.sleep" ? { result: "slept" } : {};
  }) as never;
  const state = {
    ...store.getState(),
    hosts: [host()],
    hub: { h1: { managed: sessions, history: [] } },
  } as never as ReturnType<typeof store.getState>;
  const view = (s = state) => (
    <TooltipProvider>
      <SessionsHub
        store={store}
        state={s}
        onOpen={() => {}}
        isOpen={() => false}
        density="comfortable"
      />
    </TooltipProvider>
  );
  return { store, state, asked, view };
}

const rowOf = (title: string) => screen.getByRole("listitem", { name: title });
async function openMenu(title: string) {
  await act(async () => {
    fireEvent.pointerDown(
      within(rowOf(title)).getByRole("button", { name: `Actions of ${title}` }),
      {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      },
    );
  });
}

describe("dormindo-ui: asleep sessions in the hub (issue #157)", () => {
  test("the rows know which sessions are asleep: idle ones the summary says so, never others", () => {
    const w = setup([
      session("a", "idle", { asleep: true }),
      session("b", "idle", { asleep: false }),
      session("c", "running", { asleep: true }),
    ]);
    const rows = hubRows(w.state);
    expect(rows.map((r) => [r.title, r.asleep])).toEqual([
      ["a", true],
      ["b", false],
      ["c", false],
    ]);
  });

  test("an asleep row says Asleep in words and in its state's name; an awake one does not", async () => {
    const w = setup();
    render(w.view());
    await settle(() => screen.queryByRole("listitem", { name: "sleeper" }) !== null);
    expect(rowOf("sleeper").textContent).toContain("Asleep");
    expect(within(rowOf("sleeper")).getByRole("img", { name: "asleep" })).toBeTruthy();
    expect(rowOf("awake").textContent).not.toContain("Asleep");
    expect(rowOf("busy").textContent).not.toContain("Asleep");
  });

  test("Sleep now is in the menu of an awake idle session only, and asks the host", async () => {
    const w = setup();
    render(w.view());
    await settle(() => screen.queryByRole("listitem", { name: "awake" }) !== null);
    await openMenu("sleeper");
    expect(screen.queryByRole("menuitem", { name: "Sleep now" })).toBeNull();
    cleanup();
    const again = setup();
    render(again.view());
    await openMenu("busy");
    expect(screen.queryByRole("menuitem", { name: "Sleep now" })).toBeNull();
    cleanup();
    const third = setup();
    render(third.view());
    await openMenu("awake");
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Sleep now" }));
    });
    await settle(() => third.asked.some(([t]) => t === "session.sleep"));
    expect(third.asked.find(([t]) => t === "session.sleep")?.[1]).toEqual({ sessionId: "awake" });
  });

  test("what the host answers is told in words: asleep, or why it stays awake", async () => {
    const w = setup();
    for (const [result, text] of [
      ["slept", "is asleep"],
      ["kept_awake", "is pinned or belongs to a card"],
      ["not_idle", "is working"],
    ] as const) {
      w.store.hostCommand = (async () => ({ result })) as never;
      await w.store.sleepSession("h1", "awake");
      const last = w.store.getState().notices.at(-1);
      expect(last?.text).toContain(text);
    }
  });

  test("it reads in Portuguese", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    const state = {
      ...store.getState(),
      hosts: [host()],
      hub: { h1: { managed: [session("sleeper", "idle", { asleep: true })], history: [] } },
    } as never as ReturnType<typeof store.getState>;
    render(
      <TooltipProvider>
        <SessionsHub
          store={store}
          state={state}
          onOpen={() => {}}
          isOpen={() => false}
          density="comfortable"
        />
      </TooltipProvider>,
    );
    await settle(() => screen.queryByRole("listitem", { name: "sleeper" }) !== null);
    expect(rowOf("sleeper").textContent).toContain("Dormindo");
  });
});

describe("dormindo-ui: the host's setting", () => {
  function setting(minutes?: number) {
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    const asked: Array<[string, unknown]> = [];
    store.hostCommand = (async (_h: string, type: string, payload: unknown) => {
      asked.push([type, payload]);
      return {};
    }) as never;
    store.reloadHostInfo = (async () => {
      asked.push(["reload", null]);
    }) as never;
    render(
      <TContext.Provider value={store.i18n.t}>
        <SleepSetting store={store} host={host(minutes) as never} />
      </TContext.Provider>,
    );
    return { asked };
  }

  test("it shows the delay the host has, and a change is sent and read back", async () => {
    const w = setting(30);
    const select = screen.getByLabelText("Sleep idle sessions after") as HTMLSelectElement;
    expect(select.value).toBe("30");
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Off",
      "15 minutes",
      "30 minutes",
      "1 hour",
      "4 hours",
    ]);
    await act(async () => {
      fireEvent.change(select, { target: { value: "240" } });
    });
    await settle(() => w.asked.some(([t]) => t === "reload"));
    expect(w.asked[0]).toEqual(["host.sleep", { minutes: 240 }]);
  });

  test("a host without the switch shows nothing, and Off reads as off", () => {
    setting(undefined);
    expect(screen.queryByLabelText("Sleep idle sessions after")).toBeNull();
    cleanup();
    setting(0);
    expect((screen.getByLabelText("Sleep idle sessions after") as HTMLSelectElement).value).toBe(
      "0",
    );
  });

  test("a delay the config holds outside the list is shown too, in words", () => {
    setting(45);
    const select = screen.getByLabelText("Sleep idle sessions after") as HTMLSelectElement;
    expect(select.value).toBe("45");
    expect([...select.options].map((o) => o.textContent)).toContain("45 minutes");
    cleanup();
    setting(120);
    expect(
      [...(screen.getByLabelText("Sleep idle sessions after") as HTMLSelectElement).options].map(
        (o) => o.textContent,
      ),
    ).toContain("2 hours");
  });
});
