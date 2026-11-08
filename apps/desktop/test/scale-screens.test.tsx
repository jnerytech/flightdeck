import { afterEach, describe, expect, test } from "bun:test";
import { Profiler, type ProfilerOnRenderCallback } from "react";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { scaleState, summaryBurst } from "./scale-fixture.ts";

registerDom();
const { act, cleanup, render } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { useStoreState } = await import("../src/lib/use-store.ts");
const { Sidebar } = await import("../src/ui/Sidebar.tsx");
const { SessionsHub } = await import("../src/ui/SessionsHub.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

afterEach(cleanup);

/**
 * Issue #1191: at 200 sessions on 4 hosts, a burst of one session's summaries renders the Sessions
 * page and the sidebar at most once per summary, and the Sessions page asks its hosts for nothing
 * (it asks again only when sessions come or go). Their render time per summary stayed nearly flat
 * from 20 to 800 sessions (docs/decisions/2026-11-08-scale-budgets.md): these budgets keep it so.
 */
const BURST = 10;
const counts = { sidebar: 0, hub: 0 };
const count =
  (id: keyof typeof counts): ProfilerOnRenderCallback =>
  () => {
    counts[id] += 1;
  };

function Screens(props: Readonly<{ store: InstanceType<typeof AppStore> }>) {
  const { store } = props;
  const state = useStoreState(store);
  return (
    <TooltipProvider>
      <Profiler id="sidebar" onRender={count("sidebar")}>
        <Sidebar
          store={store}
          state={state}
          collapsed={false}
          t={store.i18n.t}
          go={() => {}}
          onOpenProjectScreen={() => {}}
          onNewSession={() => {}}
          onRemoveHost={() => {}}
          onRenameHost={() => null}
          onOpenSearch={() => {}}
          onNewTab={() => {}}
          onToggleTheme={() => {}}
          onShortcuts={() => {}}
        />
      </Profiler>
      <Profiler id="hub" onRender={count("hub")}>
        <SessionsHub
          store={store}
          state={state}
          onOpen={() => {}}
          isOpen={() => false}
          density="comfortable"
        />
      </Profiler>
    </TooltipProvider>
  );
}

describe("scale-screens: Sessions and the sidebar under a burst at 200 sessions (#1191)", () => {
  test("each renders at most once per summary, and the Sessions page asks its hosts for nothing", () => {
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 600_000 });
    let asked = 0;
    store.refreshHub = async () => {
      asked += 1;
    };
    const hidden = store as unknown as {
      state: Record<string, unknown>;
      onEvent(hostId: string, envelope: unknown): void;
    };
    hidden.state = { ...store.getState(), ...scaleState({ hosts: 4, perHost: 50 }) };
    render(<Screens store={store} />);
    const before = { ...counts, asked };
    for (const envelope of summaryBurst(0, 0, BURST)) {
      act(() => hidden.onEvent("host-0", envelope));
    }
    expect({
      sidebar: counts.sidebar - before.sidebar <= BURST,
      hub: counts.hub - before.hub <= BURST,
      asked: asked - before.asked,
    }).toEqual({ sidebar: true, hub: true, asked: 0 });
    store.dispose();
  });
});
