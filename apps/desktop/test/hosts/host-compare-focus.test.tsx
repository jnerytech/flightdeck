import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settleMaybe } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { HostPage } = await import("../../src/features/hosts/page.tsx");
const { HostCompare } = await import("../../src/features/hosts/host-compare.tsx");
const { TooltipProvider } = await import("../../src/components/ui/tooltip.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");
const { en } = await import("../../src/i18n/en.ts");

setDefaultTimeout(20_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #2588: Fix in the host comparison moves the focus to the Health panel of the host it names,
 * the open one or another, once per press.
 */
const HEALTH = "Health & dependencies";
/** What has the focus, short: a heading or button by its text, anything else by its tag. */
const focused = () => {
  const el = document.activeElement;
  return el?.matches("h3, button") ? (el.textContent ?? "") : `<${el?.tagName.toLowerCase()}>`;
};

/** A host announcing the checks that make its Health panel, with no daemon behind it. */
const host = (id: string) => ({
  id,
  name: id,
  url: "ws://x",
  token: "",
  status: "online",
  info: null,
  hostInfo: {
    os: "linux",
    daemonVersion: "x",
    claudeVersion: "2.1.0",
    features: ["doctor.run", "depsCheck"],
  },
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
});

function fakeStore() {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  cleanups.push(() => store.dispose());
  store.i18n.start();
  store.hostRequest = (async (hostId: string, type: string) => {
    if (type === "doctor.run") return { ok: true, data: { ok: true, checks: [] } };
    if (type !== "deps.check") return { ok: false, code: "x", message: "no" };
    const missing = hostId === "gama";
    return {
      ok: true,
      data: {
        items: [
          {
            id: "hooks",
            group: "optional",
            state: missing ? "missing" : "ok",
            breaks: [],
            fix: [],
          },
        ],
      },
    };
  }) as never;
  store.hostCommand = (async () => null) as never;
  store.sessionLists.refresh = (async () => {}) as never;
  const hosts = ["alfa", "beta", "gama"].map(host);
  (store as unknown as { update(p: object): void }).update({ hosts, hostsLoaded: true });
  return store;
}

const page = (store: ReturnType<typeof fakeStore>, section: "health" | undefined, id = "gama") => (
  <TContext.Provider value={store.i18n.t}>
    <TooltipProvider>
      {/* Another page's Health panel sits earlier in the document. */}
      <section data-slot="host-health">
        <h3>Elsewhere</h3>
        <button type="button">Elsewhere button</button>
      </section>
      <HostPage
        store={store}
        host={store.getState().hosts.find((h) => h.id === id) as never}
        {...(section ? { section } : {})}
        onRename={() => null}
        onReconnect={() => {}}
        onOpenAutoApprovals={() => {}}
        onOpenHistory={() => {}}
        onOpenSession={() => {}}
        onOpenProject={() => {}}
        onSeeAllSessions={() => {}}
        onSeeAllProjects={() => {}}
        onNewSession={() => {}}
        onRemove={() => {}}
      />
    </TooltipProvider>
  </TContext.Provider>
);

describe("host-compare-focus: the host page takes a Health ask (#2588)", () => {
  test("a host route asking for Health puts the focus on its Health heading, not on another page's", async () => {
    const store = fakeStore();
    render(page(store, "health"));
    await settleMaybe(() => focused() === HEALTH);
    expect(focused()).toBe(HEALTH);
  });

  test("the focus moves once per ask: a later render never takes it back", async () => {
    const store = fakeStore();
    const view = render(page(store, "health"));
    await settleMaybe(() => focused() === HEALTH);
    expect(focused()).toBe(HEALTH);
    await act(async () => {
      screen.getByRole("button", { name: "Elsewhere button" }).focus();
    });
    await act(async () => {
      view.rerender(page(store, "health"));
    });
    expect(focused()).toBe("Elsewhere button");
  });

  test("a page with no ask leaves the focus alone", async () => {
    const store = fakeStore();
    render(page(store, undefined));
    await act(async () => {});
    expect(focused() === HEALTH).toBe(false);
  });
});

describe("host-compare-focus: Fix asks for the Health section of the host it names (#2588)", () => {
  const mount = async (hostId: string) => {
    const store = fakeStore();
    render(
      <TContext.Provider value={store.i18n.t}>
        <TooltipProvider>
          <HostCompare store={store} hostId={hostId} />
        </TooltipProvider>
      </TContext.Provider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en.hostCompare.show }));
    });
    await settleMaybe(() => screen.queryByRole("button", { name: "Fix Hooks on gama" }) !== null);
    return store;
  };

  test("on another host's page, the route that opens gama carries the Health ask", async () => {
    const store = await mount("alfa");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Fix Hooks on gama" }));
    });
    expect(store.router.current).toEqual({ name: "host", host: "gama", section: "health" });
  });

  test("on gama's own page, the same ask replaces the route and adds no history entry", async () => {
    const store = await mount("gama");
    const before = store.router.current;
    store.router.push({ name: "host", host: "gama" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Fix Hooks on gama" }));
    });
    const asked = store.router.current;
    store.router.back();
    expect([asked, store.router.current]).toEqual([
      { name: "host", host: "gama", section: "health" },
      before,
    ]);
  });
});
