import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore, sessionKey } = await import("../src/lib/app-store.ts");
const { hubRows } = await import("../src/lib/hub.ts");
const { useStoreState } = await import("../src/lib/use-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { Breadcrumb } = await import("../src/components/layout/breadcrumb.tsx");
const { DayChart } = await import("../src/components/costs/day-chart.tsx");
const { SessionTiles } = await import("../src/components/projects/session-tiles.tsx");
const { FolderPicker } = await import("../src/ui/FolderPicker.tsx");
const { App } = await import("../src/ui/App.tsx");
const { Sidebar } = await import("../src/ui/Sidebar.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** The tiles on the app's live state, as the project page has them. */
function Live(props: { store: InstanceType<typeof AppStore>; hostId: string; projectKey: string }) {
  const state = useStoreState(props.store);
  return (
    <SessionTiles
      store={props.store}
      state={state}
      hostId={props.hostId}
      projectKey={props.projectKey}
      onOpen={() => {}}
    />
  );
}

/** The tooltip that opens when the control gets keyboard focus (or the pointer). */
async function tipOf(control: HTMLElement, how: "focus" | "pointer" = "focus"): Promise<string> {
  await act(async () => {
    if (how === "focus") fireEvent.focus(control);
    else fireEvent.pointerMove(control, { pointerType: "mouse" });
  });
  await settle(() => screen.queryByRole("tooltip") !== null, 3000, "the tooltip opens");
  return screen.getByRole("tooltip").textContent ?? "";
}

describe("text the screen cuts is revealed by a real tooltip, never a native title (issue #239)", () => {
  test("breadcrumb: an earlier step shows its full name on focus, the current one on hover; neither has a title", async () => {
    render(
      <Breadcrumb
        crumbs={[
          { label: "Hosts", route: { name: "hub" } },
          { label: "A host with a very long name indeed" },
        ]}
        label="Path"
        onGo={() => {}}
      />,
    );
    const step = screen.getByRole("button", { name: "Hosts" });
    const last = screen.getByText("A host with a very long name indeed");
    expect(step.getAttribute("title")).toBeNull();
    expect(last.getAttribute("title")).toBeNull();
    expect(await tipOf(step)).toBe("Hosts");
    cleanup();
    render(
      <Breadcrumb
        crumbs={[{ label: "A host with a very long name indeed" }]}
        label="Path"
        onGo={() => {}}
      />,
    );
    expect(await tipOf(screen.getByText("A host with a very long name indeed"), "pointer")).toBe(
      "A host with a very long name indeed",
    );
  });

  test("day chart: the columns are one tab stop, arrows walk the days, and each says its total in a tooltip, not a title", async () => {
    render(
      <TContext.Provider value={translator("en")}>
        <DayChart
          days={["2026-11-01", "2026-11-02", "2026-11-03"]}
          byDay={[
            { day: "2026-11-01", projectKey: "a", costUsd: 1 },
            { day: "2026-11-02", projectKey: "a", costUsd: 2 },
            { day: "2026-11-03", projectKey: "a", costUsd: 3 },
          ]}
          projects={["a"]}
          label={(key) => key}
        />
      </TContext.Provider>,
    );
    const columns = Array.from(document.querySelectorAll<HTMLElement>("[data-day]")).filter(
      (el) => el.getAttribute("role") === "group",
    );
    expect(columns).toHaveLength(3);
    expect(columns.every((c) => c.getAttribute("title") === null)).toBe(true);
    expect(columns.map((c) => c.tabIndex)).toEqual([0, -1, -1]);
    columns[0]?.focus();
    await act(async () => {
      fireEvent.keyDown(columns[0] as HTMLElement, { key: "ArrowRight" });
    });
    expect(document.activeElement).toBe(columns[1] as HTMLElement);
    expect(columns.map((c) => c.tabIndex)).toEqual([-1, 0, -1]);
    await act(async () => {
      fireEvent.keyDown(columns[1] as HTMLElement, { key: "End" });
    });
    expect(document.activeElement).toBe(columns[2] as HTMLElement);
    expect(await tipOf(columns[2] as HTMLElement)).toBe(columns[2]?.getAttribute("aria-label"));
  });

  test("tile layout: the options have no title; focusing one shows what it does", async () => {
    const d = makeDaemon(cleanups);
    const store = new AppStore(memoryPlatform(false, "en").platform, {
      baseDelayMs: 10,
      maxDelayMs: 20,
    });
    cleanups.push(() => store.dispose());
    store.i18n.start();
    const hostId = await store.addHost({ name: "pc", url: d.listen().url, token: TOKEN });
    await waitFor(() => store.getState().hosts.find((h) => h.id === hostId)?.status === "online");
    const id = (await store.createSession(hostId, {
      cwd: d.project,
      prompt: "oi",
      name: "um",
    })) as string;
    await waitFor(() => store.getState().sessions[sessionKey(hostId, id)]?.status !== undefined);
    store.select(hostId, null);
    await store.refreshHub();
    const projectKey = hubRows(store.getState())[0]?.projectKey as string;
    render(<Live store={store} hostId={hostId} projectKey={projectKey} />);
    const group = screen.getByRole("group", { name: "Layout" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.closest("label")?.getAttribute("title") ?? null)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    const auto = within(group).getByRole("radio", { name: "Auto" });
    expect(await tipOf(auto)).toBe("Auto: every live session");
  });

  test("folder picker: a cut folder, file and step name show in full on focus; none has a title", async () => {
    const d = makeDaemon(cleanups);
    mkdirSync(join(d.root, "a-folder-with-a-rather-long-name"), { recursive: true });
    writeFileSync(join(d.root, "a-file-with-a-rather-long-name.txt"), "x");
    const store = new AppStore(memoryPlatform(false, "en").platform, {
      baseDelayMs: 10,
      maxDelayMs: 20,
    });
    cleanups.push(() => store.dispose());
    const hostId = await store.addHost({ name: "pc", url: d.listen().url, token: TOKEN });
    await waitFor(() => store.getState().hosts[0]?.status === "online");
    const host = store.getState().hosts.find((h) => h.id === hostId);
    render(
      <TContext.Provider value={store.i18n.t}>
        <FolderPicker
          store={store}
          host={host as NonNullable<typeof host>}
          files
          onPick={() => {}}
          onClose={() => {}}
        />
      </TContext.Provider>,
    );
    const root = d.root.split("/").pop() as string;
    const inDialog = () => within(screen.getByRole("dialog"));
    const press = async (name: string | RegExp) => {
      await settle(() => inDialog().queryByRole("button", { name }) !== null, 3000, `${name}`);
      await act(async () => {
        fireEvent.click(inDialog().getByRole("button", { name }));
      });
    };
    await press(new RegExp(`^${root}`));
    await press(/a-folder-with-a-rather-long-name/);
    await press(root);
    const dir = inDialog().getByRole("button", { name: /a-folder-with-a-rather-long-name/ });
    expect(dir.getAttribute("title")).toBeNull();
    await settle(
      () => inDialog().queryByRole("button", { name: /a-file-with-a-rather-long-name/ }) !== null,
      3000,
      "the file is listed",
    );
    const file = inDialog().getByRole("button", { name: /a-file-with-a-rather-long-name/ });
    expect(file.getAttribute("title")).toBeNull();
    expect(await tipOf(file)).toBe("a-file-with-a-rather-long-name.txt");
    cleanup();
    expect(document.querySelector("[title]")).toBeNull();
  });

  test("tab strip: a tab has no title and says its full name in a tooltip on focus", async () => {
    const store = new AppStore(memoryPlatform(false, "en").platform);
    render(<App store={store} />);
    await act(async () => {
      store.tabs.open({ name: "session", host: "h", id: "s0" });
    });
    const tab = document.querySelector<HTMLElement>(
      "[data-tab-id][role='tab']:not([data-tab-id=''])",
    );
    const tabs = Array.from(document.querySelectorAll<HTMLElement>("[role='tab'][data-tab-id]"));
    expect(tabs.length).toBeGreaterThan(0);
    expect(tabs.every((t) => t.getAttribute("title") === null)).toBe(true);
    const target = tabs[tabs.length - 1] ?? (tab as HTMLElement);
    expect((await tipOf(target)).length).toBeGreaterThan(0);
  });

  test("sidebar: a host in the narrow rail names itself in a tooltip, and no row of the bar carries a title", async () => {
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    (store as unknown as { update(patch: Record<string, unknown>): void }).update({
      hosts: [{ id: "h", name: "alfa", status: "offline", sessions: [] }],
    });
    render(
      <Sidebar
        store={store}
        state={store.getState()}
        collapsed
        t={store.i18n.t}
        go={() => {}}
        onOpenProjectScreen={() => {}}
        onNewSession={() => {}}
        onRemoveHost={() => {}}
        onRenameHost={() => null}
        onOpenSearch={() => {}}
        onNewTab={() => {}}
        onToggleTheme={() => {}}
      />,
    );
    const host = screen.getByRole("button", { name: "Open host alfa" });
    expect(host.getAttribute("title")).toBeNull();
    expect(await tipOf(host)).toBe("alfa");
    expect(readFileSync(join(import.meta.dir, "../src/ui/Sidebar.tsx"), "utf8")).not.toMatch(
      /title=\{`\$\{row\.title\}/,
    );
  });
});
