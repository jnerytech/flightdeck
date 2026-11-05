import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { CacheTimer } = await import("../src/components/hub/cache-timer.tsx");
const { SessionsHub } = await import("../src/ui/SessionsHub.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const T0 = Date.parse("2026-11-04T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

/** A store whose clock the test moves; the timer on or off, the lifetime 5 minutes or 1 hour. */
function store(
  options: { on?: boolean; hour?: boolean; view?: "cards"; lang?: "en" | "pt-BR" } = {},
) {
  const mem = memoryPlatform(false, options.lang ?? "en");
  if (options.on) mem.platform.storage.setItem("flightdeck.cacheTimer", "on");
  if (options.hour) mem.platform.storage.setItem("flightdeck.cacheTtl", "3600000");
  if (options.view) mem.platform.storage.setItem("flightdeck.hubView", options.view);
  const clock = { now: T0 };
  const app = new AppStore(mem.platform, { baseDelayMs: 600_000, now: () => clock.now });
  app.i18n.start();
  return { app, clock, mem };
}

const timer = () => screen.queryByRole("img", { name: /^Prompt cache/ });

describe("cache-timer-ui: the countdown of one idle session (issue #159)", () => {
  test("counting: m:ss, muted, and a spoken name that says minutes and seconds", () => {
    const { app, clock } = store({ on: true });
    clock.now = T0 + 170_000;
    render(<CacheTimer store={app} since={iso(T0)} />);
    const el = timer() as HTMLElement;
    expect(el.getAttribute("aria-label")).toBe("Prompt cache expires in 2 minutes 10 seconds");
    expect(el.textContent).toBe("2:10");
    expect(el.className).toContain("text-muted-foreground");
    expect(el.className).not.toContain("text-status-needs-you");
    expect(el.querySelector("svg")).not.toBeNull();
  });

  test("the spoken name uses singulars and leaves a zero out", () => {
    const { app, clock } = store({ on: true });
    clock.now = T0 + 239_000;
    render(<CacheTimer store={app} since={iso(T0)} />);
    expect(timer()?.getAttribute("aria-label")).toBe("Prompt cache expires in 1 minute 1 second");
    cleanup();
    clock.now = T0 + 245_000;
    render(<CacheTimer store={app} since={iso(T0)} />);
    expect(timer()?.getAttribute("aria-label")).toBe("Prompt cache expires in 55 seconds");
  });

  test("the last minute turns the text to the warning tone", () => {
    const { app, clock } = store({ on: true });
    clock.now = T0 + 245_000;
    render(<CacheTimer store={app} since={iso(T0)} />);
    expect(timer()?.textContent).toBe("0:55");
    expect(timer()?.className).toContain("text-status-needs-you");
  });

  test("cold: only the icon, no number, and the tooltip says what a message now costs", async () => {
    const { app, clock } = store({ on: true });
    clock.now = T0 + 300_000;
    render(<CacheTimer store={app} since={iso(T0)} />);
    const el = screen.getByRole("img", { name: "Prompt cache is cold" });
    expect(el.textContent).toBe("");
    expect(el.querySelector("svg")).not.toBeNull();
    await act(async () => {
      fireEvent.pointerMove(el, { pointerType: "mouse" });
    });
    await settle(() => screen.queryByRole("tooltip") !== null, 3000, "the tooltip opens");
    expect(screen.getByRole("tooltip").textContent).toBe(
      "The next message will re-send the full context as uncached tokens",
    );
  });

  test("counting, the tooltip names the time left", async () => {
    const { app, clock } = store({ on: true });
    clock.now = T0 + 170_000;
    render(<CacheTimer store={app} since={iso(T0)} />);
    await act(async () => {
      fireEvent.pointerMove(timer() as HTMLElement, { pointerType: "mouse" });
    });
    await settle(() => screen.queryByRole("tooltip") !== null, 3000, "the tooltip opens");
    expect(screen.getByRole("tooltip").textContent).toBe("Prompt cache expires in 2:10");
  });

  test("it counts down by itself, one second at a time", async () => {
    const { app, clock } = store({ on: true });
    clock.now = T0 + 170_000;
    render(<CacheTimer store={app} since={iso(T0)} />);
    expect(timer()?.textContent).toBe("2:10");
    clock.now = T0 + 171_000;
    await settle(() => timer()?.textContent === "2:09", 4000, "the next second");
  });

  test("off, or with no moment to count from, nothing is drawn and no clock runs", () => {
    const off = store();
    let listened = 0;
    const subscribe = off.app.clock.subscribe;
    off.app.clock.subscribe = ((l: () => void) => {
      listened++;
      return subscribe(l);
    }) as never;
    render(<CacheTimer store={off.app} since={iso(T0)} />);
    expect(timer()).toBeNull();
    expect(listened).toBe(0);
    cleanup();
    const on = store({ on: true });
    render(<CacheTimer store={on.app} since={null} />);
    expect(timer()).toBeNull();
  });

  test("the lifetime applies at once: with the hour, the same moment reads 57:10", () => {
    const { app, clock } = store({ on: true });
    clock.now = T0 + 170_000;
    render(<CacheTimer store={app} since={iso(T0)} />);
    expect(timer()?.textContent).toBe("2:10");
    act(() => app.cacheTimer.setTtl(3_600_000));
    expect(timer()?.textContent).toBe("57:10");
  });

  test("it reads in Portuguese, and the width does not move as the digits change", () => {
    const { app, clock } = store({ on: true, lang: "pt-BR" });
    clock.now = T0 + 170_000;
    render(<CacheTimer store={app} since={iso(T0)} />);
    const el = screen.getByRole("img", { name: /^Cache do prompt/ });
    expect(el.getAttribute("aria-label")).toBe("Cache do prompt expira em 2 minutos 10 segundos");
    expect(el.className).toContain("tabular-nums");
    expect(el.className).toContain("font-mono");
  });
});

const external = (id: string, status: string, since: number | null, state: string) => ({
  claudeSessionId: id,
  cwd: `/work/${id}`,
  projectKey: `host:alfa:/work/${id}`,
  status,
  controllable: false,
  lastEventAt: iso(T0),
  summary: since === null ? null : { request: null, state, tool: null, since: iso(since) },
  persona: null,
});

function hub(options: Parameters<typeof store>[0] = {}) {
  const { app, clock, mem } = store(options);
  clock.now = T0 + 170_000;
  const state = {
    ...app.getState(),
    hosts: [
      {
        id: "alfa",
        name: "alfa",
        url: "ws://x",
        token: "",
        status: "online",
        info: null,
        hostInfo: null,
        incompatibility: null,
        daemonUpdate: null,
        sessions: [],
      },
    ],
    externals: {
      "alfa/idle": external("idle", "idle", T0, "idle"),
      "alfa/busy": external("busy", "running", T0, "running"),
      "alfa/done": external("done", "ended", T0, "ended"),
      "alfa/none": external("none", "idle", null, "idle"),
    },
  };
  render(
    <TooltipProvider>
      <SessionsHub
        store={app}
        state={state as never}
        onOpen={() => {}}
        isOpen={() => false}
        density="comfortable"
      />
    </TooltipProvider>,
  );
  return { app, clock, mem };
}

const rowOf = (name: string) => screen.getByRole("listitem", { name });

describe("cache-timer-ui: on the Sessions list (issue #159)", () => {
  test("rows: only an idle session that knows since when has a countdown", async () => {
    hub({ on: true });
    await settle(() => screen.queryByRole("listitem", { name: "idle" }) !== null);
    expect(within(rowOf("idle")).getByRole("img", { name: /^Prompt cache/ }).textContent).toBe(
      "2:10",
    );
    for (const other of ["busy", "done", "none"]) {
      expect(within(rowOf(other)).queryByRole("img", { name: /^Prompt cache/ })).toBeNull();
    }
  });

  test("cards: the same, in the card's meta line", async () => {
    hub({ on: true, view: "cards" });
    await settle(() => screen.queryByRole("listitem", { name: "idle" }) !== null);
    expect(within(rowOf("idle")).getByRole("img", { name: /^Prompt cache/ }).textContent).toBe(
      "2:10",
    );
    expect(within(rowOf("busy")).queryByRole("img", { name: /^Prompt cache/ })).toBeNull();
  });

  test("with the setting off nothing is drawn", async () => {
    hub();
    await settle(() => screen.queryByRole("listitem", { name: "idle" }) !== null);
    expect(screen.queryByRole("img", { name: /^Prompt cache/ })).toBeNull();
  });
});

describe("cache-timer-ui: the setting (issue #159)", () => {
  test("Settings offers the timer, off by default, and the lifetime; both persist", async () => {
    const { app, mem } = store({ lang: "pt-BR" });
    render(<App store={app} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
    });
    await settle(() => screen.queryByLabelText("Contador do cache do prompt") !== null);
    const box = screen.getByLabelText("Contador do cache do prompt") as HTMLInputElement;
    expect(box.checked).toBe(false);
    const ttl = screen.getByLabelText("Duração do cache") as HTMLSelectElement;
    expect([...ttl.options].map((o) => o.textContent)).toEqual(["5 minutos", "1 hora"]);
    await act(async () => {
      fireEvent.click(box);
    });
    await act(async () => {
      fireEvent.change(ttl, { target: { value: "3600000" } });
    });
    expect(app.cacheTimer.enabled).toBe(true);
    expect(app.cacheTimer.ttl).toBe(3_600_000);
    expect(mem.platform.storage.getItem("flightdeck.cacheTimer")).toBe("on");
    expect(mem.platform.storage.getItem("flightdeck.cacheTtl")).toBe("3600000");
  });
});
