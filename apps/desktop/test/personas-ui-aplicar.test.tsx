import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { poll } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { personasHost } from "./personas-ui-setup.ts";

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

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(15));
}

async function click(name: string) {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await act(() => Bun.sleep(150));
}

const options = (label: string) =>
  [...((screen.queryByLabelText(label) as HTMLSelectElement | null)?.options ?? [])].map(
    (o) => o.textContent ?? "",
  );

async function openSession() {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await personasHost(cleanups, store);
  const { sessionId } = h.d.manager.create({ cwd: h.repo, prompt: "oi" });
  await poll(() => h.d.manager.get(sessionId).status === "idle");
  render(<App store={store} />);
  await settle(() => store.getState().hosts[0]?.hostInfo?.features?.includes("personas") === true);
  await act(async () => {
    store.router.push({ name: "session", host: h.hostId, id: sessionId });
  });
  return { store, sessionId, ...h };
}

describe("personas-ui: applying a persona to an open session", () => {
  test("Aplicar persona sends the role message, says it is a conversation instruction, and Voltar ao normal leaves it", async () => {
    const { d, sessionId } = await openSession();
    await settle(() => options("Aplicar persona").length > 1);
    expect(options("Aplicar persona")).toContain("QA / testes");
    // An open session keeps its system prompt: the app says so before anything is sent.
    expect(
      screen.queryByText(
        "Numa sessão aberta, a persona vale como instrução da conversa, não do sistema.",
      ),
    ).not.toBeNull();
    const field = screen.queryByLabelText("Aplicar persona") as HTMLElement;
    await act(async () => {
      fireEvent.change(field, { target: { value: "host:qa" } });
    });
    await click("Aplicar");
    await poll(() => d.manager.get(sessionId).persona?.id === "qa");
    expect(d.manager.get(sessionId).persona).toMatchObject({ id: "qa", name: "QA / testes" });
    await settle(() => screen.queryByRole("button", { name: "Voltar ao normal" }) !== null);
    await click("Voltar ao normal");
    await poll(() => !d.manager.get(sessionId).persona);
    expect(d.manager.get(sessionId).persona ?? null).toBeNull();
  });
});
