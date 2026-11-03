import { afterEach, describe, expect, test } from "bun:test";
import { assistantLine, userLine, writeTranscript } from "../../daemon/test/history-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(3000);

/** One host with a transcript whose assistant turns call tools. */
async function setup() {
  const d = makeDaemon(cleanups);
  const call = (uuid: string, ts: string, blocks: unknown[]) =>
    JSON.stringify({
      cwd: d.project,
      type: "assistant",
      message: { role: "assistant", content: blocks },
      uuid,
      timestamp: ts,
    });
  writeTranscript(d.historyRoot, "-p", "ferramentas", [
    userLine({
      uuid: "u1",
      text: "pedido inicial",
      cwd: d.project,
      ts: "2026-09-01T10:00:00.000Z",
    }),
    call("a1", "2026-09-01T10:00:01.000Z", [
      { type: "text", text: "Vou listar a agulha." },
      { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls -la src" } },
      { type: "tool_use", id: "t2", name: "Read", input: { file_path: "/p/config.json" } },
    ]),
    // What an older daemon stored for a tool call, kept as it was.
    assistantLine({
      uuid: "a2",
      text: "Outra agulha.\n[ferramenta Grep]",
      cwd: d.project,
      ts: "2026-09-01T10:00:02.000Z",
    }),
  ]);
  d.history.scan();
  const server = d.listen();
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  return { store };
}

HTMLElement.prototype.scrollIntoView = () => {};

async function openReader() {
  await act(async () => {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  });
  const input = screen.queryByLabelText("Buscar no histórico") as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { value: "inicial" } });
    fireEvent.submit(input);
  });
  await settle(() => screen.queryAllByText(/inicial/).length > 0);
  const hit = screen.queryByRole("list", { name: "Resultados da busca" })?.querySelector("button");
  await act(async () => {
    fireEvent.click(hit as HTMLElement);
  });
  await settle(() => screen.queryByRole("log", { name: "Transcript" }) !== null);
}

describe("historico-ferramentas: the transcript reader", () => {
  test("a tool call is a collapsed row with the tool and a short input, not a bracketed line", async () => {
    await setup();
    await openReader();
    const log = within(screen.getByRole("log", { name: "Transcript" }));
    await settle(() => log.queryAllByRole("figure", { name: /^Ferramenta / }).length === 3);
    const rows = log.getAllByRole("figure", { name: /^Ferramenta / });
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "Ferramenta Bash",
      "Ferramenta Read",
      "Ferramenta Grep",
    ]);
    expect(rows[0]?.textContent).toContain("Bash");
    expect(rows[0]?.textContent).toContain("ls -la src");
    expect(rows[1]?.textContent).toContain("/p/config.json");
    // The sentence around the calls stays a message.
    expect(log.queryByText("Vou listar a agulha.")).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/\[(ferramenta|tool) /);
  });
});
