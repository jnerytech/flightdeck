import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { poll } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { unfoldAll } from "./unfold.ts";
import { settle } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

/**
 * Issue #100, slice 3b: "Move to another host…" is in an idle session's menu only while the person
 * has the preview on, and only on a host that can teleport; it opens the dialog with the other hosts
 * that can take the session. The preview is a switch in Settings.
 */
setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const seen = (check: () => boolean) =>
  settle(check).then(
    () => true,
    () => false,
  );

/** Two hosts that can teleport, an idle session on the first, the app on the sessions hub. */
async function setup() {
  const alfa = makeDaemon(cleanups, { teleport: true });
  const beta = makeDaemon(cleanups, { teleport: true });
  const { sessionId } = await alfa.manager.create({ cwd: alfa.root, prompt: "oi", name: "Moving" });
  await poll(() => alfa.manager.get(sessionId).status === "idle");
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: alfa.listen().url, token: TOKEN });
    await store.addHost({ name: "beta", url: beta.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts.every((h) => h.status === "online"));
  await act(async () => {
    store.router.push({ name: "hub" });
  });
  // Every project starts folded (issue #111).
  await unfoldAll(act);
  return { store };
}

/** The entries of a session's menu (Radix opens on pointer down). */
async function menu(title: string) {
  await settle(() => screen.queryByRole("button", { name: `Actions of ${title}` }) !== null).catch(
    () => undefined,
  );
  const trigger = screen.queryByRole("button", { name: `Actions of ${title}` });
  expect(trigger).not.toBeNull();
  await act(async () => {
    fireEvent.pointerDown(trigger as HTMLElement, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
  });
  const names = screen.queryAllByRole("menuitem").map((item) => item.textContent ?? "");
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  });
  return names;
}

describe("teleport-move-ui: the entry that moves a session, behind the preview (#100)", () => {
  test("off by default there is no entry; with the preview on it opens the dialog with the other host", async () => {
    const { store } = await setup();
    const before = await menu("Moving");
    await act(async () => {
      store.setTeleportPreview(true);
    });
    const after = await menu("Moving");
    const trigger = screen.queryByRole("button", { name: "Actions of Moving" });
    await act(async () => {
      fireEvent.pointerDown(trigger as HTMLElement, {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      });
    });
    const entry = screen
      .queryAllByRole("menuitem")
      .find((i) => i.textContent === "Move to another host…");
    expect(entry).not.toBeUndefined();
    await act(async () => {
      fireEvent.click(entry as HTMLElement);
    });
    const opened = await seen(
      () => screen.queryByRole("dialog", { name: "Move to another host" }) !== null,
    );
    const hosts = [
      ...((screen.queryByRole("combobox", { name: "Host" }) as HTMLSelectElement | null)?.options ??
        []),
    ].map((o) => o.textContent ?? "");
    // A move the source refuses (this test's alfa makes no packages): the app's own text for it.
    const select = screen.queryByRole("combobox", { name: "Host" });
    await act(async () => {
      fireEvent.change(select as HTMLElement, { target: { value: store.getState().hosts[1]?.id } });
    });
    const repo = screen.queryByRole("textbox", { name: "Repository on that host" });
    expect(repo).not.toBeNull();
    await act(async () => {
      fireEvent.change(repo as HTMLElement, { target: { value: "/work/app" } });
    });
    const next = screen.queryByRole("button", { name: "Continue" });
    await act(async () => {
      fireEvent.click(next as HTMLElement);
    });
    await seen(() => screen.queryByRole("alert") !== null);
    const refused = screen.queryByRole("alert")?.textContent ?? null;
    // The form's own Close, not the dialog's X.
    const form = screen.queryByRole("alert")?.closest("form") ?? null;
    const close = form ? within(form).queryByRole("button", { name: "Close" }) : null;
    expect(close).not.toBeNull();
    await act(async () => {
      fireEvent.click(close as HTMLElement);
    });
    const closedAfterRefusal = await seen(
      () => screen.queryByRole("dialog", { name: "Move to another host" }) === null,
    );
    // Opened again, then closed with Cancel.
    await act(async () => {
      fireEvent.pointerDown(trigger as HTMLElement, {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      });
    });
    const again = screen
      .queryAllByRole("menuitem")
      .find((i) => i.textContent === "Move to another host…");
    await act(async () => {
      fireEvent.click(again as HTMLElement);
    });
    await seen(() => screen.queryByRole("dialog", { name: "Move to another host" }) !== null);
    const cancel = screen.queryByRole("button", { name: "Cancel" });
    expect(cancel).not.toBeNull();
    await act(async () => {
      fireEvent.click(cancel as HTMLElement);
    });
    const closed = await seen(
      () => screen.queryByRole("dialog", { name: "Move to another host" }) === null,
    );
    expect([
      before.includes("Move to another host…"),
      after.includes("Move to another host…"),
      opened,
      hosts,
      refused,
      closedAfterRefusal,
      closed,
    ]).toEqual([
      false,
      true,
      true,
      ["Pick a host", "beta"],
      "This host does not offer moving a session to another host: update the daemon, or check its settings.",
      true,
      true,
    ]);
  });

  test("the preview is a switch in Settings, off until the person turns it on", async () => {
    const { store } = await setup();
    await act(async () => {
      store.router.push({ name: "settings", section: "window" });
    });
    await settle(
      () =>
        screen.queryByRole("checkbox", { name: "Preview: move a session to another host" }) !==
        null,
    ).catch(() => undefined);
    const box = screen.queryByRole("checkbox", { name: "Preview: move a session to another host" });
    expect(box).not.toBeNull();
    const before = (box as HTMLInputElement).checked;
    await act(async () => {
      fireEvent.click(box as HTMLElement);
    });
    expect([before, store.getState().settings.teleportPreview]).toEqual([false, true]);
  });
});
