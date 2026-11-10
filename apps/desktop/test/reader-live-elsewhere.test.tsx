import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ExternalSession } from "@flightdeck/protocol";
import { assistantLine, userLine, writeTranscript } from "../../daemon/test/history-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(4000);

const ID = "77777777-7777-4777-8777-777777777777";

const waitingElsewhere = (cwd: string): ExternalSession => ({
  claudeSessionId: ID,
  cwd,
  transcriptPath: null,
  source: "resume",
  status: "unknown",
  statusReason: null,
  launchId: null,
  controllable: false,
  projectKey: null,
  startedAt: "2026-11-10T12:00:00Z",
  lastEventAt: "2026-11-10T12:00:00Z",
  endedAt: null,
});

/** A stored conversation whose `claude` is still alive in another terminal, waiting at a prompt. */
async function openReader(external: boolean) {
  const d = makeDaemon(cleanups, { terminals: true });
  writeTranscript(d.historyRoot, "-p", ID, [
    userLine({ uuid: "u1", text: "falando da girafa", cwd: d.project }),
    assistantLine({ uuid: "a1", text: "a girafa é alta", cwd: d.project }),
  ]);
  await d.history.scan();
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  const hostId = await act(async () =>
    store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN }),
  );
  await settle(() => store.getState().hosts[0]?.status === "online");
  if (external) {
    (store as unknown as { update(patch: object): void }).update({
      externals: { [`${hostId}/${ID}`]: waitingElsewhere(d.project) },
    });
  }
  await act(async () => {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  });
  const input = screen.queryByLabelText("Buscar no histórico") as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { value: "girafa" } });
    fireEvent.submit(input);
  });
  const results = () =>
    screen.queryByRole("list", { name: "Resultados da busca" })?.querySelector("button") ?? null;
  await settle(() => results() !== null);
  await act(async () => {
    fireEvent.click(results() as HTMLElement);
  });
  await settle(() => screen.queryByRole("button", { name: "Continuar no terminal" }) !== null);
  return { ...d, store, hostId };
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

describe("reader-live-elsewhere: the stored conversation of a session alive in another terminal (#1705)", () => {
  test("Continuar no terminal asks first and starts no second claude on the same conversation", async () => {
    const { ptys } = await openReader(true);
    await click("Continuar no terminal");
    expect(screen.queryByText("Já aberta em outro terminal")).not.toBeNull();
    expect(ptys.spawned).toHaveLength(0);
  });

  test("Abrir outra cópia mesmo assim is the person's choice and resumes the conversation", async () => {
    const { ptys } = await openReader(true);
    await click("Continuar no terminal");
    await click("Abrir outra cópia mesmo assim");
    await settle(() => ptys.spawned.length === 1);
    expect(ptys.spawned[0]?.argv).toContain("--resume");
    expect(ptys.spawned[0]?.argv).toContain(ID);
  });

  test("a conversation nobody runs elsewhere opens at once, with no question", async () => {
    const { ptys } = await openReader(false);
    await click("Continuar no terminal");
    expect(screen.queryByText("Já aberta em outro terminal")).toBeNull();
    await settle(() => ptys.spawned.length === 1);
  });
});
