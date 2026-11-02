import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";
import { assistantLine, userLine, writeTranscript } from "../../daemon/test/history-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(20_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(4000);
const ID = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

/** A transcript of the session `n` in `cwd`, written by the entrypoint given (none for an old one). */
function transcript(d: ReturnType<typeof makeDaemon>, n: number, cwd: string, entrypoint = "cli") {
  const lines = [
    userLine({ uuid: `u${n}`, text: `pedido ${n}`, cwd, ts: `2026-09-0${n}T10:00:00.000Z` }),
    assistantLine({ uuid: `a${n}`, text: "ok", cwd, ts: `2026-09-0${n}T10:00:01.000Z` }),
  ].map((l) => JSON.stringify({ ...JSON.parse(l), entrypoint }));
  writeTranscript(d.historyRoot, `-p${n}`, ID(n), lines);
}

async function online(build: (d: ReturnType<typeof makeDaemon>) => void) {
  const d = makeDaemon(cleanups);
  build(d);
  d.history.scan();
  const store = new AppStore(memoryPlatform(false, "en-US").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  return { d, store, hostId: store.getState().hosts[0]?.id ?? "" };
}

const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    fireEvent.click(el as HTMLElement);
  });
};

describe("historico: the runs nobody typed", () => {
  const build = (d: ReturnType<typeof makeDaemon>) => {
    transcript(d, 1, "/home/dev/app");
    transcript(d, 2, "/home/dev/app", "sdk-cli");
    transcript(d, 3, "/tmp/e2e/proj");
  };
  const rows = () => {
    const list = screen.queryByRole("list", { name: "History sessions" });
    return list ? within(list).queryAllByRole("listitem") : [];
  };

  test("they are hidden by default, with how many and a way to show them", async () => {
    const { store, hostId } = await online(build);
    await act(async () => store.router.push({ name: "history", host: hostId }));
    await settle(() => screen.queryByRole("list", { name: "History sessions" }) !== null);
    expect(rows()).toHaveLength(1);
    const hide = screen.getByRole("checkbox", { name: "Hide automated runs" }) as HTMLInputElement;
    expect(hide.checked).toBe(true);
    expect(screen.queryByText("2 automated runs hidden")).not.toBeNull();
    await click(screen.getByRole("button", { name: "Show them" }));
    await settle(() => rows().length === 3);
    expect(
      (screen.getByRole("checkbox", { name: "Hide automated runs" }) as HTMLInputElement).checked,
    ).toBe(false);
    // Shown, they are marked.
    expect(screen.queryAllByText(/automated/i).length).toBeGreaterThan(0);
  });

  test("the box brings the filter back", async () => {
    const { store, hostId } = await online(build);
    await act(async () => store.router.push({ name: "history", host: hostId }));
    await settle(() => screen.queryByRole("checkbox", { name: "Hide automated runs" }) !== null);
    await click(screen.getByRole("checkbox", { name: "Hide automated runs" }));
    await settle(() => rows().length === 3);
    await click(screen.getByRole("checkbox", { name: "Hide automated runs" }));
    await settle(() => rows().length === 1);
  });

  test("with nothing automated there is no note about hidden runs", async () => {
    const { store, hostId } = await online((d) => transcript(d, 1, "/home/dev/app"));
    await act(async () => store.router.push({ name: "history", host: hostId }));
    await settle(() => rows().length === 1);
    expect(screen.queryByText(/automated runs? hidden/)).toBeNull();
  });
});

describe("historico: a session in a folder the host does not allow", () => {
  async function reader(ctx: Awaited<ReturnType<typeof online>>) {
    // The list hides temp folders: open the session from the search, as a person would.
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    const input = screen.getByLabelText("Search the history") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "pedido" } });
      fireEvent.submit(input);
    });
    const hit = () =>
      screen.queryByRole("list", { name: "Search results" })?.querySelector("button") ?? null;
    await settle(() => hit() !== null);
    await click(hit());
    await settle(() => screen.queryByRole("button", { name: "Continue in Flightdeck" }) !== null);
  }

  test("both ways to continue are off, with the reason, and the folder can be allowed right there", async () => {
    const vault = realTempDir("fd-vault-");
    const ctx = await online((d) => transcript(d, 1, vault));
    await reader();
    const cont = screen.getByRole("button", {
      name: "Continue in Flightdeck",
    }) as HTMLButtonElement;
    expect(cont.disabled).toBe(true);
    expect(screen.queryByText(/outside .*allowed folders/)).not.toBeNull();
    await click(screen.getByRole("button", { name: "Add to allowed folders" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent ?? "").toContain(vault);
    await click(within(dialog).getByRole("button", { name: "Add to allowed folders" }));
    await settle(
      () =>
        (
          screen.queryByRole("button", {
            name: "Continue in Flightdeck",
          }) as HTMLButtonElement | null
        )?.disabled === false,
    );
    expect(screen.queryByRole("button", { name: "Add to allowed folders" })).toBeNull();
  });

  test("a folder that is gone says so, and offers nothing to add", async () => {
    const vault = realTempDir("fd-vault-");
    const ctx = await online((d) => transcript(d, 1, `${vault}/gone`));
    await reader();
    expect(
      (screen.getByRole("button", { name: "Continue in Flightdeck" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByText(/no longer exists on this host/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Add to allowed folders" })).toBeNull();
  });

  test("a folder inside the allowed ones keeps the buttons on", async () => {
    const ctx = await online((d) => transcript(d, 1, d.project));
    await reader();
    expect(
      (screen.getByRole("button", { name: "Continue in Flightdeck" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(screen.queryByRole("button", { name: "Add to allowed folders" })).toBeNull();
  });
});
