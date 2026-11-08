import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settleMaybe, stays } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { Sidebar } = await import("../src/ui/Sidebar.tsx");
const { APP_VERSION } = await import("../src/lib/version.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

const host = (daemonVersion: string | null) => ({
  id: "h",
  name: "alfa",
  url: "ws://127.0.0.1:1/v1/ws",
  status: "online",
  sessions: [],
  ...(daemonVersion ? { hostInfo: { daemonVersion, features: [] } } : {}),
});

function sidebar(daemonVersion: string | null, collapsed = false, lang: "en" | "pt-BR" = "en") {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const state = { ...store.getState(), hosts: [host(daemonVersion)] } as never;
  render(
    <Sidebar
      store={store}
      state={state}
      collapsed={collapsed}
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
}

/** Focuses the host's button and returns the tooltip that opens, or "" when none does. */
async function tipOnFocus(name: string): Promise<string> {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.focus(button as HTMLElement);
  });
  await settleMaybe(() => screen.queryByRole("tooltip") !== null, 2000);
  return screen.queryByRole("tooltip")?.textContent ?? "";
}

describe("sidebar-host-version: a host says its daemon's version in a real tooltip (issue #281)", () => {
  test("the host's row, on keyboard focus: the daemon's version", async () => {
    sidebar(APP_VERSION);
    expect(await tipOnFocus("Open host alfa")).toBe(`flightdeckd ${APP_VERSION}`);
  });

  test("another version than the app's is said in words, and the mark has no native title", async () => {
    sidebar("0.1.0");
    expect(await tipOnFocus("Open host alfa")).toBe(
      "flightdeckd 0.1.0 · different version from the app's",
    );
    const mark = screen.queryByRole("img", { name: "alfa: different version" });
    expect(mark).not.toBeNull();
    expect(mark?.querySelector("title")).toBeNull();
  });

  test("in the narrow rail the tooltip names the host and then its version", async () => {
    sidebar("0.1.0", true);
    expect(await tipOnFocus("Open host alfa")).toBe(
      "alfa · flightdeckd 0.1.0 · different version from the app's",
    );
  });

  test("before the host has said its version, the row has no tooltip and the rail only the name", async () => {
    sidebar(null);
    const button = screen.queryByRole("button", { name: "Open host alfa" });
    await act(async () => {
      if (button) fireEvent.focus(button);
    });
    await stays(() => screen.queryByRole("tooltip") === null, 600, "no tooltip");
    cleanup();
    sidebar(null, true);
    expect(await tipOnFocus("Open host alfa")).toBe("alfa");
  });

  test("the row keeps its button, and the keyboard focus on it, when the version arrives", async () => {
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    const view = (daemonVersion: string | null) => (
      <Sidebar
        store={store}
        state={{ ...store.getState(), hosts: [host(daemonVersion)] } as never}
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
      />
    );
    const { rerender } = render(view(null));
    const before = screen.queryByRole("button", { name: "Open host alfa" });
    expect(before).not.toBeNull();
    await act(async () => {
      before?.focus();
    });
    await act(async () => {
      rerender(view(APP_VERSION));
    });
    expect(before?.isConnected).toBe(true);
    expect(document.activeElement === before).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("it reads in Portuguese too", async () => {
    sidebar("0.1.0", false, "pt-BR");
    expect(await tipOnFocus("Abrir host alfa")).toBe(
      "flightdeckd 0.1.0 · versão diferente da do app",
    );
  });
});
