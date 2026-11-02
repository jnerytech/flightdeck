import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { RecapPanel } = await import("../src/ui/RecapPanel.tsx");
const { ExternalView } = await import("../src/ui/ExternalView.tsx");
const { App } = await import("../src/ui/App.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(20_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(4000);
const SESSION = "eeeeeeee-0000-4000-8000-000000000030";

const line = (value: unknown) => JSON.stringify(value);
/** The daemons the test started, newest last. */
const daemons: Array<ReturnType<typeof makeDaemon>> = [];

async function online(language: string, options: { legacy?: boolean; plain?: boolean } = {}) {
  const mem = memoryPlatform(false, language);
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  store.i18n.start();
  if (options.legacy) {
    const legacy = legacyDaemon(cleanups);
    await act(async () => {
      await store.addHost({ name: "alfa", url: legacy.url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    return { store, mem };
  }
  const d = makeDaemon(cleanups, { summary: true });
  daemons.push(d);
  const server = d.listen();
  mkdirSync(d.historyRoot, { recursive: true });
  const file = join(d.historyRoot, `${SESSION}.jsonl`);
  writeFileSync(
    file,
    [
      line({ type: "user", message: { role: "user", content: "Add a retry to the queue" } }),
      line({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Retry added with backoff." },
            ...(options.plain
              ? []
              : [
                  { type: "tool_use", name: "Edit", input: { file_path: "/r/queue.ts" } },
                  { type: "tool_use", name: "Write", input: { file_path: "/r/queue.test.ts" } },
                ]),
          ],
        },
      }),
    ].join("\n"),
  );
  d.eventStore.db
    .query(
      `INSERT INTO history_sessions (claude_session_id, cwd, title, first_ts, last_ts, message_count, origin, file_path)
       VALUES (?, '/work/app', 't', '2026-11-01T12:00:00.000Z', '2026-11-01T12:01:30.000Z', 2, 'external', ?)`,
    )
    .run(SESSION, file);
  d.eventStore.db
    .query(
      `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
         speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
       VALUES ('m1', ?, '2026-11-01T12:00:00.000Z', '2026-11-01', 'p', 'm', 'terminal', 'standard', 1, 1, 0, 0, 0, 1.5)`,
    )
    .run(SESSION);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.hostInfo !== null);
  return { store, mem };
}

const show = async (store: InstanceType<typeof AppStore>, question?: string) => {
  const hostId = store.getState().hosts[0]?.id as string;
  render(
    <TContext.Provider value={store.i18n.t}>
      <RecapPanel
        store={store}
        hostId={hostId}
        claudeSessionId={SESSION}
        {...(question ? { question } : {})}
      />
    </TContext.Provider>,
  );
};

describe("resumo-ui", () => {
  test("it shows what was asked and done, the files, the cost and the open question (pt-BR)", async () => {
    const { store } = await online("pt-BR");
    await show(store, "Rodar o teste?");
    await settle(() => screen.queryByText("Add a retry to the queue") !== null);
    const region = screen.getByRole("region", { name: "Resumo da sessão" });
    expect(region.textContent).toContain("Pedido");
    expect(region.textContent).toContain("Retry added with backoff.");
    expect(region.textContent).toContain("/r/queue.ts");
    expect(region.textContent).toContain("/r/queue.test.ts");
    expect(region.textContent).toContain("US$ 1.50");
    expect(region.textContent).toContain("Pergunta em aberto");
    expect(region.textContent).toContain("Rodar o teste?");
  });

  test("the same in English", async () => {
    const { store } = await online("en");
    await show(store);
    await settle(() => screen.queryByText("Add a retry to the queue") !== null);
    const region = screen.getByRole("region", { name: "Session summary" });
    expect(region.textContent).toContain("Asked");
    expect(region.textContent).toContain("Done");
    expect(region.textContent).not.toContain("Open question");
  });

  test("Copy summary puts the summary as text on the clipboard", async () => {
    const { store, mem } = await online("en");
    const copied: string[] = [];
    mem.platform.copyText = async (text) => {
      copied.push(text);
    };
    await show(store);
    await settle(() => screen.queryByRole("button", { name: "Copy summary" }) !== null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy summary" }));
    });
    expect(copied).toEqual([
      "Asked: Add a retry to the queue\nDone: Retry added with backoff.\nFiles: /r/queue.ts, /r/queue.test.ts\nCost: US$ 1.50",
    ]);
  });

  test("a session the host has not indexed says there is no summary yet", async () => {
    const { store } = await online("en");
    const hostId = store.getState().hosts[0]?.id as string;
    render(
      <TContext.Provider value={store.i18n.t}>
        <RecapPanel store={store} hostId={hostId} claudeSessionId="unknown" />
      </TContext.Provider>,
    );
    await settle(
      () =>
        screen.queryByText(
          "The summary appears after the session's first turn and refreshes by itself.",
        ) !== null,
    );
    // Not indexed yet is a normal state: no toast.
    expect(store.getState().error).toBeNull();
  });

  test("the same empty state in Portuguese", async () => {
    const { store } = await online("pt-BR");
    const hostId = store.getState().hosts[0]?.id as string;
    render(
      <TContext.Provider value={store.i18n.t}>
        <RecapPanel store={store} hostId={hostId} claudeSessionId="unknown" />
      </TContext.Provider>,
    );
    await settle(
      () =>
        screen.queryByText(
          "O resumo aparece depois do primeiro turno da sessão e se atualiza sozinho.",
        ) !== null,
    );
  });

  test("it asks again until the host has indexed the transcript, then shows the summary", async () => {
    const { store } = await online("en");
    const hostId = store.getState().hosts[0]?.id as string;
    const later = "eeeeeeee-0000-4000-8000-000000000031";
    render(
      <TContext.Provider value={store.i18n.t}>
        <RecapPanel store={store} hostId={hostId} claudeSessionId={later} retryMs={30} />
      </TContext.Provider>,
    );
    await settle(() => screen.queryByText(/appears after the session's first turn/) !== null);
    const d = daemons.at(-1) as ReturnType<typeof makeDaemon>;
    const file = join(d.historyRoot, `${later}.jsonl`);
    writeFileSync(
      file,
      `${line({ type: "user", message: { role: "user", content: "Late prompt" } })}\n`,
    );
    d.eventStore.db
      .query(
        `INSERT INTO history_sessions (claude_session_id, cwd, title, first_ts, last_ts, message_count, origin, file_path)
         VALUES (?, '/work/app', 't', '2026-11-01T12:00:00.000Z', '2026-11-01T12:01:30.000Z', 1, 'external', ?)`,
      )
      .run(later, file);
    await settle(() => screen.queryByText("Late prompt") !== null);
  });

  test("a host without the feature shows nothing at all", async () => {
    const { store } = await online("en", { legacy: true });
    await show(store);
    await act(() => Bun.sleep(50));
    expect(screen.queryByRole("region")).toBeNull();
  });

  test("a session that changed no file has no files row", async () => {
    const { store } = await online("en", { plain: true });
    await show(store);
    await settle(() => screen.queryByText("Add a retry to the queue") !== null);
    expect(screen.getByRole("region", { name: "Session summary" }).textContent).not.toContain(
      "Files",
    );
  });

  test("a session Flightdeck started shows its summary on its own page", async () => {
    const mem = memoryPlatform(false, "en");
    const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
    store.i18n.start();
    const d = makeDaemon(cleanups, { summary: true });
    const server = d.listen();
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.hostInfo !== null);
    const managed = d.manager.create({ cwd: d.project, prompt: "oi" });
    await settle(() => d.manager.get(managed.sessionId).claudeSessionId !== null);
    const claudeId = d.manager.get(managed.sessionId).claudeSessionId as string;
    mkdirSync(d.historyRoot, { recursive: true });
    const file = join(d.historyRoot, `${claudeId}.jsonl`);
    writeFileSync(
      file,
      `${line({ type: "user", message: { role: "user", content: "Managed prompt" } })}\n`,
    );
    d.eventStore.db
      .query(
        `INSERT INTO history_sessions (claude_session_id, cwd, title, first_ts, last_ts, message_count, origin, file_path)
         VALUES (?, ?, 't', '2026-11-01T12:00:00.000Z', '2026-11-01T12:01:30.000Z', 1, 'managed', ?)`,
      )
      .run(claudeId, d.project, file);
    const hostId = store.getState().hosts[0]?.id as string;
    await act(async () => {
      store.tabs.open({ name: "session", host: hostId, id: managed.sessionId });
    });
    await settle(() => screen.queryByRole("region", { name: "Session summary" }) !== null);
    await settle(() => screen.queryByText("Managed prompt") !== null);
  });

  test("a terminal session with no name and no folder yet is titled New session, never its id", async () => {
    const { store } = await online("en");
    const hostId = store.getState().hosts[0]?.id as string;
    const raw = "8a99bd9b-6700-49a0-a0d2-9ac93ce2044b";
    render(
      <TContext.Provider value={store.i18n.t}>
        <ExternalView
          store={store}
          state={store.getState()}
          hostId={hostId}
          hostName="alfa"
          claudeSessionId={raw}
          onResumed={() => {}}
        />
      </TContext.Provider>,
    );
    // The page header and the transcript reader's own one.
    for (const heading of screen.getAllByRole("heading", { level: 2 })) {
      expect(heading.textContent).toBe("New session");
    }
    expect(document.body.textContent).not.toContain(raw);
  });
});
