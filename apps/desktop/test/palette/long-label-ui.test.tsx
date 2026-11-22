import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { GlobalSearch } = await import("../../src/features/palette/ui.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

const LONG =
  "Move the admin panel sign-in to the new identity provider without dropping the open sessions";

/** The palette with one session named `LONG`, which is also the most recent entry (so it has a keycap). */
function open() {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.palette.load = (async () => {}) as never;
  store.palette.recents = () => ["session:h1/a"];
  const state = {
    ...store.getState(),
    hosts: [
      {
        id: "h1",
        name: "alfa",
        url: "ws://x",
        token: "",
        status: "online",
        info: null,
        hostInfo: { daemonVersion: "x", features: ["issues"] },
        incompatibility: null,
        daemonUpdate: null,
        sessions: [
          {
            id: "a",
            name: LONG,
            cwd: "/work/api/a",
            status: "idle",
            pendingPermissions: [],
            updatedAt: "2026-11-04T10:00:00Z",
          },
        ],
      },
    ],
    projects: {},
  } as never as ReturnType<typeof store.getState>;
  render(
    <GlobalSearch
      state={state}
      store={store}
      costs={true}
      onSearch={() => {}}
      onClose={() => {}}
      onOpenHit={() => {}}
      onGo={() => {}}
    />,
  );
}

describe("palette-long-label: a long label is cut with an ellipsis, not at the dialog edge (#3888)", () => {
  const rowOf = () =>
    within(screen.getByRole("listbox", { name: "Recent" })).getByRole("option", { name: LONG });

  test("the label truncates and its title is the whole text", () => {
    open();
    const label = within(rowOf()).getByText(LONG);
    expect({
      truncates: label.classList.contains("truncate"),
      shrinks: label.classList.contains("min-w-0"),
      nowrapShrink0: label.classList.contains("shrink-0"),
      title: label.getAttribute("title"),
    }).toEqual({ truncates: true, shrinks: true, nowrapShrink0: false, title: LONG });
  });

  test("the detail gives way before the label, so a short label next to a long path is not cut", () => {
    open();
    const detail = within(rowOf()).getByText("alfa · /work/api/a");
    expect(detail.className.split(" ")).toContain("shrink-[3]");
  });
});
