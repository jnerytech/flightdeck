import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AppStore, sessionKey } = await import("../src/lib/app-store.ts");
const { hubRows } = await import("../src/lib/hub.ts");
const { useStoreState } = await import("../src/lib/use-store.ts");
const { SessionTiles } = await import("../src/components/projects/session-tiles.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** The tiles on the app's live state, as the project page has them. */
function Live(props: {
  store: InstanceType<typeof AppStore>;
  hostId: string;
  projectKey: string;
  onOpen(row: { sessionId: string | null }): void;
}) {
  const state = useStoreState(props.store);
  return (
    <SessionTiles
      store={props.store}
      state={state}
      hostId={props.hostId}
      projectKey={props.projectKey}
      onOpen={props.onOpen as never}
    />
  );
}

/** A host with `names.length` sessions of one folder, the first one asking for a permission. */
async function setup(names: string[]) {
  const d = makeDaemon(cleanups);
  const server = d.listen();
  const mem = memoryPlatform(false, "en");
  const store = new AppStore(mem.platform, { baseDelayMs: 10, maxDelayMs: 20 });
  cleanups.push(() => store.dispose());
  store.i18n.start();
  const hostId = await store.addHost({ name: "pc", url: server.url, token: TOKEN });
  await waitFor(() => store.getState().hosts.find((h) => h.id === hostId)?.status === "online");
  const ids: string[] = [];
  for (const [at, name] of names.entries()) {
    const id = (await store.createSession(hostId, {
      cwd: d.project,
      prompt: at === 0 ? "[tool]" : `oi ${name}`,
      name,
    })) as string;
    ids.push(id);
    await waitFor(() => store.getState().sessions[sessionKey(hostId, id)]?.status !== undefined);
  }
  store.select(hostId, null);
  await store.refreshHub();
  const projectKey = hubRows(store.getState())[0]?.projectKey as string;
  const opened: string[] = [];
  render(
    <Live
      store={store}
      hostId={hostId}
      projectKey={projectKey}
      onOpen={(row) => void opened.push(row.sessionId as string)}
    />,
  );
  return { store, hostId, ids, opened, d };
}

const tiles = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-slot='session-tile']"));

describe("lado-a-lado-ui: the tiles of a project", () => {
  test("a section names them, and each session of the project is a tile with its status and last lines", async () => {
    await setup(["um", "dois", "tres"]);
    expect(screen.getByRole("heading", { name: "Sessions side by side" })).toBeTruthy();
    await waitFor(() => tiles().length === 3, "three tiles");
    const names = tiles().map((t) => t.getAttribute("aria-label"));
    expect(names.sort()).toEqual(["dois", "tres", "um"]);
    const dois = screen.getByRole("region", { name: "dois" });
    await waitFor(() =>
      (within(dois).queryByLabelText("Last lines")?.textContent ?? "").includes("Echo: oi dois"),
    );
    expect(within(dois).getByText("idle")).toBeTruthy();
  });

  test("the count is 2, 3, 4 or 6 tiles, 4 to start, and it is kept", async () => {
    const { store } = await setup(["a", "b", "c", "d", "e"]);
    const group = screen.getByRole("group", { name: "Tiles on screen" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((r) => r.getAttribute("aria-label")),
    ).toEqual(["2 tiles", "3 tiles", "4 tiles", "6 tiles"]);
    await waitFor(() => tiles().length === 4, "four tiles");
    expect(
      (within(group).getByRole("radio", { name: "4 tiles" }) as HTMLInputElement).checked,
    ).toBe(true);
    await act(async () => {
      fireEvent.click(within(group).getByRole("radio", { name: "2 tiles" }));
    });
    expect(tiles()).toHaveLength(2);
    expect(store.tileCount()).toBe(2);
    await act(async () => {
      fireEvent.click(within(group).getByRole("radio", { name: "6 tiles" }));
    });
    expect(tiles()).toHaveLength(5);
  });

  test("the session that needs you comes first, shows its request, and Allow answers it", async () => {
    const { store, hostId, ids } = await setup(["pede", "quieta"]);
    await waitFor(() => tiles().length === 2, "two tiles");
    expect(tiles()[0]?.getAttribute("aria-label")).toBe("pede");
    const tile = tiles()[0] as HTMLElement;
    const ask = await waitFor(
      () => within(tile).queryByRole("group", { name: "Request" }),
      "request",
    );
    expect(ask?.textContent).toContain("Write");
    await act(async () => {
      fireEvent.click(within(tile).getByRole("button", { name: "Allow" }));
    });
    await waitFor(
      () => within(tile).queryByRole("group", { name: "Request" }) === null,
      "answered",
    );
    expect(store.getState().sessions[sessionKey(hostId, ids[0] as string)]?.pending).toEqual([]);
  });

  test("the small composer: Enter sends to that session only, Ctrl+Enter breaks the line, the send icon needs text", async () => {
    await setup(["um", "dois"]);
    await waitFor(() => tiles().length === 2, "two tiles");
    const dois = screen.getByRole("region", { name: "dois" });
    const um = screen.getByRole("region", { name: "um" });
    const box = within(dois).getByRole("textbox", {
      name: "Message to dois",
    }) as HTMLTextAreaElement;
    expect(within(dois).queryByRole("button", { name: "Send" })).toBeNull();
    fireEvent.change(box, { target: { value: "ola" } });
    expect(within(dois).getByRole("button", { name: "Send" })).toBeTruthy();
    box.setSelectionRange(1, 1);
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    });
    expect(box.value).toBe("o\nla");
    fireEvent.change(box, { target: { value: "segunda" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(box.value).toBe("");
    await waitFor(
      () =>
        (within(dois).queryByLabelText("Last lines")?.textContent ?? "").includes("Echo: segunda"),
      "answer in its tile",
    );
    expect(within(um).queryByLabelText("Last lines")?.textContent ?? "").not.toContain("segunda");
  });

  test("Open takes you to the session", async () => {
    const { opened, ids } = await setup(["um", "dois"]);
    await waitFor(() => tiles().length === 2, "two tiles");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open dois" }));
    });
    expect(opened).toHaveLength(1);
    expect(ids).toContain(opened[0] as string);
  });

  test("Alt+arrows move between tiles: left and right by one, up and down by a row", async () => {
    await setup(["a", "b", "c", "d"]);
    await waitFor(() => tiles().length === 4, "four tiles");
    const all = tiles();
    (all[0] as HTMLElement).focus();
    await act(async () => {
      fireEvent.keyDown(all[0] as HTMLElement, { key: "ArrowRight", altKey: true });
    });
    expect(document.activeElement).toBe(all[1] as HTMLElement);
    await act(async () => {
      fireEvent.keyDown(all[1] as HTMLElement, { key: "ArrowDown", altKey: true });
    });
    expect(document.activeElement).toBe(all[3] as HTMLElement);
    await act(async () => {
      fireEvent.keyDown(all[3] as HTMLElement, { key: "ArrowLeft", altKey: true });
    });
    expect(document.activeElement).toBe(all[2] as HTMLElement);
    await act(async () => {
      fireEvent.keyDown(all[2] as HTMLElement, { key: "ArrowUp", altKey: true });
    });
    expect(document.activeElement).toBe(all[0] as HTMLElement);
    expect(all[0]?.getAttribute("tabindex")).toBe("0");
    expect(all[0]?.getAttribute("aria-keyshortcuts")).toContain("Alt+ArrowRight");
  });

  test("a project without sessions shows nothing", async () => {
    await setup([]);
    expect(screen.queryByRole("heading", { name: "Sessions side by side" })).toBeNull();
  });
});
