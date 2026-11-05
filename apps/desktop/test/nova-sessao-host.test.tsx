import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { newSessionHost } = await import("../src/lib/new-session-host.ts");
const { NewSessionForm } = await import("../src/ui/NewSessionForm.tsx");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** The app in English with two hosts online, "one" and "two". */
async function twoHosts() {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const one = await store.addHost({
    name: "one",
    url: makeDaemon(cleanups).listen().url,
    token: TOKEN,
  });
  const two = await store.addHost({
    name: "two",
    url: makeDaemon(cleanups).listen().url,
    token: TOKEN,
  });
  render(<App store={store} />);
  await settle(() => store.getState().hosts.every((h) => h.status === "online"));
  return { store, one, two };
}

describe("nova-sessao-host: the host is a choice on the form (issue #186, J3)", () => {
  test("with two hosts online the form has a Host field, and picking the other opens its form", async () => {
    const { store, one, two } = await twoHosts();
    await act(async () => {
      store.router.push({ name: "new-session", host: one });
    });
    await settle(() => screen.queryByLabelText("Host") !== null);
    const field = screen.getByLabelText("Host") as HTMLSelectElement;
    expect([...field.options].map((o) => o.textContent)).toEqual(["one", "two"]);
    expect(field.value).toBe(one);
    await act(async () => {
      fireEvent.change(field, { target: { value: two } });
    });
    expect(store.router.current).toMatchObject({ name: "new-session", host: two });
    await settle(() => screen.queryByRole("heading", { name: "New session on two" }) !== null);
  });

  test("with one host there is no Host field to choose from", async () => {
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    const only = await store.addHost({
      name: "only",
      url: makeDaemon(cleanups).listen().url,
      token: TOKEN,
    });
    render(<App store={store} />);
    await settle(() => store.getState().hosts[0]?.status === "online");
    await act(async () => {
      store.router.push({ name: "new-session", host: only });
    });
    await settle(() => screen.queryByRole("heading", { name: "New session on only" }) !== null);
    expect(screen.queryByLabelText("Host")).toBeNull();
  });

  test("the new-session button of the empty window uses the host last used, not the first", () => {
    const hosts = [
      { id: "a", status: "online" },
      { id: "b", status: "online" },
      { id: "c", status: "offline" },
    ] as never;
    expect(newSessionHost(hosts, { hostId: "b", sessionId: null })?.id).toBe("b");
    expect(newSessionHost(hosts, { hostId: "c", sessionId: null })?.id).toBe("a");
    expect(newSessionHost(hosts, null)?.id).toBe("a");
    expect(newSessionHost([{ id: "c", status: "offline" }] as never, null)).toBeUndefined();
  });
});

describe("nova-sessao-host: a host with no folder says where to add one (issue #186, J3)", () => {
  test("the reason has a link to the host's page, and the link goes there", () => {
    let went = 0;
    render(
      <NewSessionForm
        host={{ id: "h", name: "alfa", info: { allowedRoots: [] }, hostInfo: null } as never}
        onCreate={() => {}}
        onAddFolder={() => {
          went += 1;
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Adicionar uma pasta na página de alfa" }));
    expect(went).toBe(1);
  });
});

describe("nova-sessao-host: the Sessions list can start a session (issue #186, J3)", () => {
  test("a New session button in the list header opens the form", async () => {
    const { store, one } = await twoHosts();
    await act(async () => {
      store.router.push({ name: "hub" });
    });
    await settle(() => document.querySelector('[data-slot="page-actions"]') !== null);
    const bar = document.querySelector('[data-slot="page-actions"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(within(bar).getByRole("button", { name: "New session" }));
    });
    expect(store.router.current).toMatchObject({ name: "new-session", host: one });
  });
});
