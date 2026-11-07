import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
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
const { isPlainRemote } = await import("../src/lib/teleport.ts");
const { TeleportMove } = await import("../src/ui/TeleportMove.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

/**
 * Issue #100: the transcript and the code travel through the app, so a move warns when either host
 * is reached over plain `ws://` and not on this machine. `wss://` and loopback hosts get no warning.
 */
setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });

describe("teleport-plainws: which hosts are plain and remote (#100)", () => {
  test("ws:// off this machine is plain; wss://, loopback and a bad address are not", () => {
    expect(
      [
        "ws://192.168.1.5:7420/v1/ws",
        "ws://pi.lan:7420/v1/ws",
        "ws://100.64.0.9:7420/v1/ws",
        "wss://pi.example.com/v1/ws",
        "ws://127.0.0.1:7420/v1/ws",
        "ws://localhost:7420/v1/ws",
        "ws://[::1]:7420/v1/ws",
        "not a url",
      ].map(isPlainRemote),
    ).toEqual([true, true, true, false, false, false, false, false]);
  });
});

/** Two hosts that can teleport, the app's addresses for them replaced by the test's. */
async function setup(urls: { from?: string; to?: string }) {
  const alfa = makeDaemon(cleanups, { teleport: true });
  const beta = makeDaemon(cleanups, { teleport: true });
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
  store.i18n.start();
  cleanups.push(() => store.dispose());
  const from = await store.addHost({ name: "alfa", url: alfa.listen().url, token: TOKEN });
  const to = await store.addHost({ name: "beta", url: beta.listen().url, token: TOKEN });
  await waitFor(() =>
    expect(store.getState().hosts.every((h) => h.status === "online")).toBe(true),
  );
  // The address the person typed is what the warning reads; the connection is already up.
  for (const [id, url] of [
    [from, urls.from],
    [to, urls.to],
  ] as const) {
    // biome-ignore lint/suspicious/noExplicitAny: the test swaps the address the view shows
    if (url) (store as any).updateHost(id, (h: any) => ({ ...h, url }));
  }
  render(
    <TContext.Provider value={store.i18n.t}>
      <TeleportMove store={store} hostId={from} sessionId="s1" onClose={() => {}} />
    </TContext.Provider>,
  );
  const select = await waitFor(() => screen.getByRole("combobox", { name: "Host" }));
  return { select, to };
}

const pick = async (select: HTMLElement, id: string) => {
  await act(async () => {
    fireEvent.change(select, { target: { value: id } });
  });
};
const warning = () => screen.queryByRole("note")?.textContent ?? null;

describe("teleport-plainws: the dialog warns before a move over plain ws:// (#100)", () => {
  test("a remote ws:// target is named in the warning", async () => {
    const { select, to } = await setup({ to: "ws://192.168.1.5:7420/v1/ws" });
    await pick(select, to);
    expect(warning()).toBe(
      "beta connects without TLS (plain ws://). The transcript and the code of the session travel through this app unencrypted: move only over a network you trust.",
    );
  });

  test("a remote ws:// source and target are both named", async () => {
    const { select, to } = await setup({
      from: "ws://pi.lan:7420/v1/ws",
      to: "ws://192.168.1.5:7420/v1/ws",
    });
    await pick(select, to);
    expect(warning()?.startsWith("alfa, beta connect without TLS")).toBe(true);
  });

  test("loopback hosts and wss:// get no warning, and none before a host is picked", async () => {
    const { select, to } = await setup({ to: "wss://pi.example.com/v1/ws" });
    const before = warning();
    await pick(select, to);
    expect([before, warning()]).toEqual([null, null]);
  });
});
