import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, SYSTEM_FOLDER, TOKEN } from "./fixtures.ts";
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

async function online(language: string) {
  const d = makeDaemon(cleanups);
  const mem = memoryPlatform(false, language);
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  return { d, store, hostId: store.getState().hosts[0]?.id ?? "" };
}

describe("toast-pasta: a folder outside the allowed ones can be allowed from its refusal", () => {
  test("the toast offers it, a confirmation names folder and host, and the action runs again", async () => {
    const { d, store, hostId } = await online("en-US");
    const vault = realTempDir("fd-vault-");
    await act(async () => {
      await store.createSession(hostId, { cwd: vault, prompt: "hi" });
    });
    await settle(() => screen.queryAllByRole("alert").length === 1);
    const toast = screen.getAllByRole("alert")[0] as HTMLElement;
    const add = within(toast).queryByRole("button", { name: "Add to allowed folders" });
    expect(add).not.toBeNull();
    // It waits to be acted on: Close is there, and nothing was asked of the host yet.
    expect(within(toast).queryByRole("button", { name: "Close" })).not.toBeNull();
    expect(store.getState().hosts[0]?.info?.allowedRoots).toEqual([d.root]);
    await act(async () => {
      fireEvent.click(add as HTMLElement);
    });
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent ?? "").toContain(vault);
    expect(dialog.textContent ?? "").toContain("alfa");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Add to allowed folders" }));
    });
    await settle(() => store.getState().hosts[0]?.info?.allowedRoots.includes(vault) === true);
    // The refused action ran again, now inside an allowed folder.
    await settle(() => store.getState().selected?.sessionId != null);
  });

  test("a command other than a new session also runs again once the folder is allowed", async () => {
    const { store, hostId } = await online("en-US");
    const vault = realTempDir("fd-vault-");
    await act(async () => {
      await store.hostCommand(hostId, "project.add", { path: vault });
    });
    await settle(() => screen.queryAllByRole("alert").length === 1);
    const toast = screen.getAllByRole("alert")[0] as HTMLElement;
    await act(async () => {
      fireEvent.click(within(toast).getByRole("button", { name: "Add to allowed folders" }));
    });
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", {
          name: "Add to allowed folders",
        }),
      );
    });
    await settle(() => store.getState().hosts[0]?.info?.allowedRoots.includes(vault) === true);
    // The retry reached the host again: now it refuses for another reason (not a git repository).
    await settle(() =>
      screen
        .queryAllByRole("alert")
        .some((a) => (a.textContent ?? "").includes("is not a git repository")),
    );
  });

  test("cancelling the confirmation changes nothing; in Portuguese the button is translated", async () => {
    const { d, store, hostId } = await online("pt-BR");
    const vault = realTempDir("fd-vault-");
    await act(async () => {
      await store.createSession(hostId, { cwd: vault, prompt: "oi" });
    });
    await settle(() => screen.queryAllByRole("alert").length === 1);
    const toast = screen.getAllByRole("alert")[0] as HTMLElement;
    await act(async () => {
      fireEvent.click(
        within(toast).getByRole("button", { name: "Adicionar às pastas permitidas" }),
      );
    });
    const dialog = screen.getByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(store.getState().hosts[0]?.info?.allowedRoots).toEqual([d.root]);
  });

  test("the host refusing the folder (a system folder) says why in a toast", async () => {
    const { store, hostId } = await online("en-US");
    await act(async () => {
      expect(await store.allowRoot(hostId, SYSTEM_FOLDER)).toBe(false);
    });
    await settle(() => screen.queryAllByRole("alert").length >= 1);
    expect(screen.getAllByRole("alert")[0]?.textContent ?? "").toContain("is a system folder");
  });
});
