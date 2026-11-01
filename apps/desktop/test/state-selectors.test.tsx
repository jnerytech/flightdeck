import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Profiler, type ReactNode } from "react";
import { registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

registerDom();
const { act, cleanup, render } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { useStoreSlice, useStoreState } = await import("../src/lib/use-store.ts");

setDefaultTimeout(60_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** Two reachable hosts and one that never answers, whose reconnect attempts flip its status. */
async function threeHosts() {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 200 });
  cleanups.push(() => store.dispose());
  const alfa = legacyDaemon(cleanups);
  const beta = legacyDaemon(cleanups);
  await act(async () => {
    await store.addHost({ name: "alfa", url: alfa.url, token: TOKEN });
    await store.addHost({ name: "beta", url: beta.url, token: TOKEN });
    await store.addHost({ name: "gama", url: "ws://127.0.0.1:1/", token: TOKEN });
  });
  const deadline = Date.now() + 5000;
  while (
    store.getState().hosts.filter((h) => h.status === "online").length < 2 &&
    Date.now() < deadline
  ) {
    await act(() => Bun.sleep(10));
  }
  return { store, alfa, beta };
}

const listCalls = (daemon: { asked: string[] }) =>
  daemon.asked.filter((type) => type === "session.list").length;

describe("state-selectors: a quiet app does not refetch or redraw what did not change", () => {
  test("a host that keeps failing to connect does not make the hub ask the online hosts again", async () => {
    const { store, alfa, beta } = await threeHosts();
    render(<App store={store} />);
    await act(() => Bun.sleep(600));
    const before = [listCalls(alfa), listCalls(beta)];
    // The unreachable host changes status meanwhile: that is not a reason to ask the others.
    await act(() => Bun.sleep(2500));
    expect([listCalls(alfa), listCalls(beta)]).toEqual(before);
  });

  test("a refresh of the hub that finds the same lists keeps the state it had and tells nobody", async () => {
    const { store } = await threeHosts();
    await store.refreshHub();
    const first = store.getState();
    let told = 0;
    const stop = store.subscribe(() => told++);
    await store.refreshHub();
    stop();
    expect(told).toBe(0);
    const second = store.getState();
    expect(second.hub).toBe(first.hub);
    expect(second.meta).toBe(first.meta);
    expect(second.externals).toBe(first.externals);
    expect(second.names).toBe(first.names);
  });
});

/** Reads two parts of the state and shows what it read. */
const SEARCH_AND_NOTICES = ["searchOpen", "notices"] as const;
function Slice(props: { store: InstanceType<typeof AppStore> }) {
  const slice = useStoreSlice(props.store, SEARCH_AND_NOTICES);
  return <p>{`${slice.searchOpen}/${slice.notices.length}`}</p>;
}

describe("state-selectors: a screen that reads some parts of the state renders for those only", () => {
  test("useStoreSlice renders when a part it reads is replaced, and for no other change", async () => {
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 600_000 });
    cleanups.push(() => store.dispose());
    let commits = 0;
    const view = render(
      <Profiler id="slice" onRender={() => commits++}>
        <Slice store={store} />
      </Profiler>,
    );
    expect(view.container.textContent).toBe("false/0");
    const mounted = commits;
    await act(async () => store.select("nowhere", null)); // `selected` is not read
    await act(async () => store.chooseSnippet(null)); // neither is `snippetChoice`
    expect(commits).toBe(mounted);
    await act(async () => store.openSearch()); // `searchOpen` is
    expect(view.container.textContent).toBe("true/0");
    expect(commits).toBe(mounted + 1);
    await act(async () => store.success("hello"));
    expect(view.container.textContent).toBe("true/1");
    expect(commits).toBe(mounted + 2);
  });
});

/** Re-renders on every change of the state, like `App`, and draws a fresh element each time. */
function Parent(props: { store: InstanceType<typeof AppStore>; build(): ReactNode }) {
  useStoreState(props.store);
  return <>{props.build()}</>;
}

describe("state-selectors: an unrelated change of the state does not render the screens that do not read it", () => {
  type Store = InstanceType<typeof AppStore>;

  /** The store as a screen sees it, counting how often the screen reads its translator: once per render. */
  function counted(store: Store) {
    const seen = { renders: 0 };
    const proxy = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === "i18n") seen.renders++;
        return Reflect.get(target, prop, receiver);
      },
    });
    return { proxy, seen };
  }

  test("a parent that renders for every change does not render these (here: a search opening and closing)", async () => {
    const { UpdateBanner } = await import("../src/ui/UpdateBanner.tsx");
    const { Notices } = await import("../src/components/feedback/notices.tsx");
    const { TeamsPage } = await import("../src/ui/TeamsPage.tsx");
    const { PersonasPage } = await import("../src/ui/PersonasPage.tsx");
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 600_000 });
    cleanups.push(() => store.dispose());
    const screens: Array<[string, ReturnType<typeof counted>, (s: Store) => ReactNode]> = [
      ["UpdateBanner", counted(store), (s) => <UpdateBanner store={s} />],
      ["Notices", counted(store), (s) => <Notices store={s} />],
      ["TeamsPage", counted(store), (s) => <TeamsPage store={s} />],
      ["PersonasPage", counted(store), (s) => <PersonasPage store={s} />],
    ];
    render(
      <Parent
        store={store}
        build={() => (
          <>
            {screens.map(([name, { proxy }, draw]) => (
              <div key={name}>{draw(proxy)}</div>
            ))}
          </>
        )}
      />,
    );
    const mounted = screens.map(([, { seen }]) => seen.renders);
    expect(mounted.every((n) => n > 0)).toBe(true);
    await act(async () => store.openSearch());
    await act(async () => store.closeSearch());
    expect(screens.map(([, { seen }]) => seen.renders)).toEqual(mounted);
    // What `Notices` reads does render it.
    await act(async () => store.success("hello"));
    expect(screens[1]?.[1].seen.renders).toBeGreaterThan(mounted[1] as number);
  });

  test("every screen that reads some parts of the state is a memo component, so a parent's render skips it", async () => {
    const { UpdateBanner } = await import("../src/ui/UpdateBanner.tsx");
    const { Notices } = await import("../src/components/feedback/notices.tsx");
    const { AskpassPrompt } = await import("../src/components/connections/askpass-prompt.tsx");
    const { QuotaPanel } = await import("../src/ui/QuotaPanel.tsx");
    const { TeamsPage } = await import("../src/ui/TeamsPage.tsx");
    const { PluginsPage } = await import("../src/ui/PluginsPage.tsx");
    const { PersonasPage } = await import("../src/ui/PersonasPage.tsx");
    const { SnippetsPage } = await import("../src/ui/SnippetsPage.tsx");
    const { CostsPage } = await import("../src/ui/CostsPage.tsx");
    const { ConnectionsPage } = await import("../src/ui/ConnectionsPage.tsx");
    const { ConversationsPage } = await import("../src/ui/ConversationsPage.tsx");
    const { Settings } = await import("../src/ui/Settings.tsx");
    const { TargetForm } = await import("../src/components/connections/target-form.tsx");
    const memo = Symbol.for("react.memo");
    for (const screen of [
      UpdateBanner,
      Notices,
      AskpassPrompt,
      QuotaPanel,
      TeamsPage,
      PluginsPage,
      PersonasPage,
      SnippetsPage,
      CostsPage,
      ConnectionsPage,
      ConversationsPage,
      Settings,
      TargetForm,
    ]) {
      expect((screen as unknown as { $$typeof: symbol }).$$typeof).toBe(memo);
    }
  });
});
