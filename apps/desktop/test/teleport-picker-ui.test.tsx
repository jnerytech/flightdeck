import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
const {
  act,
  cleanup,
  fireEvent,
  render,
  within,
  waitFor: rtlWaitFor,
} = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { TeleportMove } = await import("../src/ui/TeleportMove.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

/**
 * Issue #100: the repository on the target host is chosen by browsing that host's folders
 * (`fs.dirs`), not only typed; a host that cannot browse keeps the typed field.
 */
setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });

async function setup(options: { canBrowse?: boolean } = {}) {
  const alfa = makeDaemon(cleanups, { teleport: true });
  const beta = makeDaemon(cleanups, { teleport: true });
  mkdirSync(join(beta.root, "app"), { recursive: true });
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
  store.i18n.start();
  cleanups.push(() => store.dispose());
  const from = await store.addHost({ name: "alfa", url: alfa.listen().url, token: TOKEN });
  const to = await store.addHost({ name: "beta", url: beta.listen().url, token: TOKEN });
  await waitFor(() =>
    expect(store.getState().hosts.every((h) => h.status === "online")).toBe(true),
  );
  if (options.canBrowse === false) {
    // An older daemon: it announces teleport but not the folder listing.
    // biome-ignore lint/suspicious/noExplicitAny: the test narrows the target's announced features
    (store as any).updateHost(to, (h: any) => ({
      ...h,
      hostInfo: {
        ...h.hostInfo,
        features: h.hostInfo.features.filter((f: string) => f !== "fs.dirs"),
      },
    }));
  }
  render(
    <TContext.Provider value={store.i18n.t}>
      <TeleportMove store={store} hostId={from} sessionId="s1" onClose={() => {}} />
    </TContext.Provider>,
  );
  const select = await waitFor(() => screen.getByRole("combobox", { name: "Host" }));
  await act(async () => {
    fireEvent.change(select, { target: { value: to } });
  });
  return { beta, store };
}

const repoBox = () => screen.getByRole("textbox", { name: "Repository on that host" });
const browse = () => screen.queryByRole("button", { name: "Browse…" });
const picker = () => screen.queryByRole("dialog", { name: "Choose folder" });
const inPicker = (name: string | RegExp) =>
  within(picker() as HTMLElement).queryByRole("button", { name });
const press = async (name: string | RegExp) => {
  await waitFor(() => expect(inPicker(name) !== null).toBe(true)); // NOSONAR: not.toBeNull on a DOM element inside waitFor formats the DOM tree on each retry (docs/TDD.md)
  await act(async () => {
    fireEvent.click(inPicker(name) as HTMLElement);
  });
};

describe("teleport-picker-ui: the repository on the target is picked from its folders (#100)", () => {
  test("Browse opens the target's folders, and the folder chosen fills the field", async () => {
    const { beta } = await setup();
    await waitFor(() => expect(browse() !== null).toBe(true)); // NOSONAR: not.toBeNull on a DOM element inside waitFor formats the DOM tree on each retry (docs/TDD.md)
    await act(async () => {
      fireEvent.click(browse() as HTMLElement);
    });
    await waitFor(() => expect(picker() !== null).toBe(true)); // NOSONAR: not.toBeNull on a DOM element inside waitFor formats the DOM tree on each retry (docs/TDD.md)
    await press(new RegExp(`^${basename(beta.root)}`));
    await press("app");
    await waitFor(() => expect(inPicker("Choose this folder") !== null).toBe(true)); // NOSONAR: not.toBeNull on a DOM element inside waitFor formats the DOM tree on each retry (docs/TDD.md)
    await press("Choose this folder");
    await waitFor(() => expect(picker()).toBeNull());
    expect((repoBox() as HTMLInputElement).value).toBe(join(beta.root, "app"));
  });

  test("a path can still be typed, and closing the picker changes nothing", async () => {
    await setup();
    await act(async () => {
      fireEvent.change(repoBox(), { target: { value: "/typed/app" } });
    });
    await waitFor(() => expect(browse() !== null).toBe(true)); // NOSONAR: not.toBeNull on a DOM element inside waitFor formats the DOM tree on each retry (docs/TDD.md)
    await act(async () => {
      fireEvent.click(browse() as HTMLElement);
    });
    await waitFor(() => expect(picker() !== null).toBe(true)); // NOSONAR: not.toBeNull on a DOM element inside waitFor formats the DOM tree on each retry (docs/TDD.md)
    await act(async () => {
      fireEvent.keyDown(picker() as HTMLElement, { key: "Escape" });
    });
    await waitFor(() => expect(picker()).toBeNull());
    expect((repoBox() as HTMLInputElement).value).toBe("/typed/app");
  });

  test("a path typed for one host is gone when another host is picked", async () => {
    await setup();
    await act(async () => {
      fireEvent.change(repoBox(), { target: { value: "/typed/app" } });
    });
    const select = screen.getByRole("combobox", { name: "Host" });
    const to = (select as HTMLSelectElement).value;
    await act(async () => {
      fireEvent.change(select, { target: { value: "" } });
    });
    await act(async () => {
      fireEvent.change(select, { target: { value: to } });
    });
    expect((repoBox() as HTMLInputElement).value).toBe("");
  });

  test("a target that cannot list folders keeps the typed field alone", async () => {
    await setup({ canBrowse: false });
    expect([repoBox() !== null, browse()]).toEqual([true, null]);
  });
});
