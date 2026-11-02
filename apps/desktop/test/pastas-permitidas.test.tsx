import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";
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

async function hostPage() {
  const d = makeDaemon(cleanups);
  const store = new AppStore(memoryPlatform(false, "en-US").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id ?? "";
  await act(async () => store.router.push({ name: "host", host: hostId }));
  await settle(() => screen.queryByRole("list", { name: "Allowed folders of this host" }) !== null);
  return { d, store };
}

const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    fireEvent.click(el as HTMLElement);
  });
};

describe("pastas-permitidas: the allowed folders in the host's settings", () => {
  test("they are listed, and a folder is added after a confirmation naming it and the host", async () => {
    const { d, store } = await hostPage();
    const list = screen.getByRole("list", { name: "Allowed folders of this host" });
    expect(
      within(list)
        .queryAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([d.root]);
    const add = screen.getByRole("button", { name: "Add to allowed folders" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(screen.queryByText("Type the folder to allow.")).not.toBeNull();
    const vault = realTempDir("fd-vault-");
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Folder to allow"), { target: { value: vault } });
    });
    await click(screen.getByRole("button", { name: "Add to allowed folders" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent ?? "").toContain(vault);
    expect(dialog.textContent ?? "").toContain("alfa");
    await click(within(dialog).getByRole("button", { name: "Add to allowed folders" }));
    await settle(() => store.getState().hosts[0]?.info?.allowedRoots.includes(vault) === true);
    await settle(
      () =>
        within(screen.getByRole("list", { name: "Allowed folders of this host" })).queryAllByRole(
          "listitem",
        ).length === 2,
    );
  });

  test("a refusal from the host (a system folder) is told in a toast and the list stays", async () => {
    const { d } = await hostPage();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Folder to allow"), { target: { value: "/etc" } });
    });
    await click(screen.getByRole("button", { name: "Add to allowed folders" }));
    await click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Add to allowed folders",
      }),
    );
    await settle(() =>
      screen.queryAllByRole("alert").some((a) => (a.textContent ?? "").includes("system folder")),
    );
    const list = screen.getByRole("list", { name: "Allowed folders of this host" });
    expect(
      within(list)
        .queryAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([d.root]);
  });
});
