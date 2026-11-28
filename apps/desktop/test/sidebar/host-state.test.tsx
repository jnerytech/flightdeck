import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { cleanup, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { Sidebar } = await import("../../src/features/shell/sidebar.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/** A version before every badge's `until`: a release bump never changes what these tests render (#3466). */
const BEFORE_EVERY_BADGE = "0.1.0";

function setup(language: string, status: string, collapsed: boolean) {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const state = {
    ...store.getState(),
    hosts: [{ id: "h1", name: "alfa", status, hostInfo: null, sessions: [] }],
  } as never as ReturnType<typeof store.getState>;
  render(
    <Sidebar
      store={store}
      state={state}
      collapsed={collapsed}
      appVersion={BEFORE_EVERY_BADGE}
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

/** What a screen reader says after the button's name: the text of the elements it points to. */
function descriptionOf(name: string): string | null {
  const button = screen.queryByRole("button", { name });
  if (!button) return null;
  const ids = (button.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.getAttribute("aria-label") ?? "").join(" ");
}

describe("sidebar-host-state: a host's connection state is announced with its button (#4500)", () => {
  test("an offline host's row says its state after its name", () => {
    setup("en", "offline", false);
    expect(descriptionOf("Open host alfa")).toBe("alfa: offline");
  });

  test("the folded rail's button says it too, in Portuguese when the app is", () => {
    setup("pt-BR", "unauthorized", true);
    expect(descriptionOf("Abrir host alfa")).toBe("alfa: token recusado");
  });
});
