import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { poll } from "../../daemon/test/helpers.ts";
import { userLine, writeTranscript } from "../../daemon/test/history-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { Page } = await import("../src/components/layout/page.tsx");
const { formatWhen } = await import("../src/i18n/format.ts");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

/** One host with two managed sessions, "Alpha" and "Beta", both idle. */
async function setup() {
  const d = makeDaemon(cleanups);
  const names = ["Alpha", "Beta"];
  for (const name of names) {
    const { sessionId } = d.manager.create({ cwd: d.project, prompt: "oi", name });
    await poll(() => d.manager.get(sessionId).status === "idle");
  }
  // One finished transcript of the terminal, for the history.
  writeTranscript(d.historyRoot, "-p", "s-antiga", [
    userLine({
      uuid: "u1",
      text: "Revisar o build",
      cwd: d.project,
      ts: "2026-09-01T10:00:00.000Z",
    }),
  ]);
  d.history.scan();
  const mem = memoryPlatform();
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.sessions.length === 2);
  await sidebar.openHub();
  await settle(() => screen.queryByRole("listitem", { name: "Beta" }) !== null);
  return { d, store, mem };
}

const main = () => screen.queryByRole("main") as HTMLElement;
const row = (title: string) => within(main()).queryByRole("listitem", { name: title });
const split = () => within(main()).queryByRole("group");
const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    fireEvent.click(el as HTMLElement);
  });
};
const press = async (key: string, target: EventTarget = window) => {
  await act(async () => {
    fireEvent.keyDown(target as Element, { key });
  });
};

describe("direcao-visual: três colunas", () => {
  test("Sessões: a lista à esquerda e, sem sessão aberta, a direita diz o que fazer", async () => {
    await setup();
    expect(split()).not.toBeNull();
    expect(
      within(main()).queryByRole("separator", { name: "Redimensionar a lista" }),
    ).not.toBeNull();
    expect(within(main()).queryByRole("heading", { name: "Sessões" })).not.toBeNull();
    expect(row("Alpha")).not.toBeNull();
    expect(within(main()).queryByText("Escolha uma sessão para ver a conversa.")).not.toBeNull();
    expect(main().querySelector("svg[class*='size-10']")).not.toBeNull();
  });

  test("abrir uma sessão põe a conversa à direita e deixa a lista; Esc fecha o detalhe", async () => {
    const { store } = await setup();
    await click(within(row("Alpha") as HTMLElement).queryByRole("button", { name: "Alpha" }));
    expect(store.router.current.name).toBe("session");
    await settle(() => screen.queryByLabelText("Mensagem") !== null);
    expect(screen.queryByLabelText("Mensagem")).not.toBeNull();
    // The list stays, with the open one marked.
    expect(row("Beta")).not.toBeNull();
    expect(row("Alpha")?.getAttribute("aria-current")).toBe("true");
    expect(row("Beta")?.getAttribute("aria-current")).toBeNull();
    expect(within(main()).queryByText("Escolha uma sessão para ver a conversa.")).toBeNull();
    await press("Escape", screen.queryByLabelText("Mensagem") as HTMLElement);
    expect(store.router.current.name).toBe("hub");
    expect(within(main()).queryByText("Escolha uma sessão para ver a conversa.")).not.toBeNull();
    expect(row("Alpha")?.getAttribute("aria-current")).toBeNull();
  });

  test("a linha compacta tem 32 px: pontinho, título, host em cinza e a hora à direita", async () => {
    await setup();
    const alpha = row("Alpha") as HTMLElement;
    expect(alpha.className).toContain("h-8");
    expect(alpha.className).not.toContain("min-h-10");
    expect(within(alpha).queryByRole("img", { name: "ociosa" })).not.toBeNull();
    expect(within(alpha).queryByText(/^alfa/)?.className ?? "").toContain("text-muted-foreground");
    const time = alpha.querySelector("time");
    expect(time?.className ?? "").toContain("tabular-nums");
    // The time closes the line; the actions wait for hover or focus.
    expect(alpha.lastElementChild?.getAttribute("data-slot")).not.toBe("badge");
    const menu = within(alpha).queryByRole("button", { name: "Ações de Alpha" });
    expect(menu?.className ?? "").toContain("opacity-0");
    expect(menu?.className ?? "").toContain("focus-visible:opacity-100");
    expect(menu?.className ?? "").toContain("group-hover:opacity-100");
  });

  test("a hora da linha é curta (HH:MM hoje, dia e mês antes) e inteira no tooltip", async () => {
    const now = Date.parse("2026-09-01T15:00:00Z");
    const zone = "America/Sao_Paulo";
    expect(formatWhen("2026-09-01T10:00:00Z", now, "pt-BR", zone)).toBe("07:00");
    expect(formatWhen("2026-08-31T10:00:00Z", now, "pt-BR", zone)).toBe("31 de ago.");
    expect(formatWhen("2026-08-31T10:00:00Z", now, "en", zone)).toBe("Aug 31");
    // 02:00 UTC is still the day before in São Paulo.
    expect(formatWhen("2026-09-01T02:00:00Z", now, "pt-BR", zone)).toBe("31 de ago.");
    await setup();
    const time = row("Alpha")?.querySelector("time");
    expect(time?.textContent).toMatch(/^\d{2}:\d{2}$/);
    expect(time?.getAttribute("title")).toMatch(/^\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}$/);
  });

  test("uma data ilegível vira texto vazio na linha, sem derrubar a lista", () => {
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    expect(() => store.formatWhen("não é uma data")).not.toThrow();
    expect(store.formatWhen("não é uma data")).toBe("");
  });

  test("o título leva o espaço da linha; o resumo é uma segunda linha só na densidade confortável", async () => {
    const { store } = await setup();
    const summary = () => row("Alpha")?.querySelector("[data-slot='summary']");
    expect(
      within(row("Alpha") as HTMLElement).queryByRole("button", { name: "Alpha" })?.className,
    ).toContain("flex-1");
    // Compact: one line, the summary only for screen readers.
    expect(summary()?.textContent ?? "").not.toBe("");
    expect(summary()?.className ?? "").toContain("sr-only");
    await act(async () => {
      store.density.set("comfortable");
    });
    expect(summary()?.className ?? "").not.toContain("sr-only");
    expect(summary()?.className ?? "").toContain("basis-full");
    expect(row("Alpha")?.className ?? "").toContain("flex-wrap");
  });

  test("os filtros da lista são compactos (32 px)", async () => {
    await setup();
    for (const label of ["Host", "Origem", "Estado"]) {
      expect(screen.queryByLabelText(label)?.className ?? "").toContain("h-8");
    }
    expect(screen.queryByLabelText("Filtrar sessões")?.className ?? "").toContain("h-8");
  });

  test("em Configurações a densidade confortável (40 px) vale para a lista e fica guardada", async () => {
    const { store, mem } = await setup();
    await click(screen.queryByRole("button", { name: "Configurações" }));
    const select = screen.queryByLabelText("Densidade da lista") as HTMLSelectElement | null;
    expect(select?.value).toBe("compact");
    expect([...(select?.options ?? [])].map((o) => o.textContent)).toEqual([
      "Compacta",
      "Confortável",
    ]);
    await act(async () => {
      fireEvent.change(select as HTMLSelectElement, { target: { value: "comfortable" } });
    });
    expect(store.density.value).toBe("comfortable");
    expect(mem.platform.storage.getItem("flightdeck.density")).toBe("comfortable");
    await sidebar.openHub();
    expect(row("Alpha")?.className ?? "").toContain("min-h-10");
    expect(row("Alpha")?.className ?? "").not.toContain("h-8");
  });

  test("J e K movem pela lista, Enter abre e as teclas ficam com o campo quando se digita", async () => {
    const { store } = await setup();
    // The managed ones and the transcript from the terminal, in the order they are listed.
    const order = [...main().querySelectorAll("li[data-active]")].map((li) =>
      li.getAttribute("aria-label"),
    );
    expect(order).toHaveLength(3);
    const active = () =>
      [...main().querySelectorAll("li[data-active='true']")].map((li) =>
        li.getAttribute("aria-label"),
      );
    await press("j");
    expect(active()).toEqual([order[0] ?? ""]);
    await press("j");
    expect(active()).toEqual([order[1] ?? ""]);
    await press("j");
    await press("j");
    expect(active()).toEqual([order[2] ?? ""]);
    await press("k");
    expect(active()).toEqual([order[1] ?? ""]);
    // Typing in the filter is text.
    const input = screen.queryByLabelText("Filtrar sessões") as HTMLElement;
    await press("j", input);
    expect(active()).toEqual([order[1] ?? ""]);
    await press("Enter");
    expect(store.router.current.name).toBe("session");
  });

  test("Histórico: a lista do host à esquerda e o leitor à direita", async () => {
    const { store } = await setup();
    await sidebar.hostAction("Histórico");
    const list = () => screen.queryByRole("list", { name: "Sessões do histórico" });
    await settle(() => list()?.querySelector("button") != null);
    expect(
      within(main()).queryByRole("separator", { name: "Redimensionar a lista" }),
    ).not.toBeNull();
    expect(within(main()).queryByText("Escolha uma sessão para ler.")).not.toBeNull();
    await click(list()?.querySelector("button") as HTMLElement);
    expect(store.router.current.name).toBe("reader");
    await settle(() => screen.queryByRole("log", { name: "Transcript" }) !== null);
    expect(screen.queryByRole("log", { name: "Transcript" })).not.toBeNull();
    // The list stays beside it, and Esc goes back to it.
    expect(list()).not.toBeNull();
    await press("Escape", screen.queryByRole("log", { name: "Transcript" }) as HTMLElement);
    expect(store.router.current.name).toBe("history");
    expect(within(main()).queryByText("Escolha uma sessão para ler.")).not.toBeNull();
  });

  test("Histórico de um host que ainda não conectou mostra só o carregamento, sem a lista", async () => {
    const mem = memoryPlatform();
    const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    // Nothing listens there: the host stays out of reach.
    const hostId = await act(() =>
      store.addHost({ name: "longe", url: "ws://127.0.0.1:9", token: TOKEN }),
    );
    await act(async () => {
      store.router.push({ name: "history", host: hostId });
    });
    expect(screen.queryByRole("status", { name: "Conectando a longe…" })).not.toBeNull();
    expect(within(main()).queryByRole("separator")).toBeNull();
    expect(screen.queryByRole("list", { name: "Sessões do histórico" })).toBeNull();
  });

  test("o corpo de uma página nunca passa da largura da coluna: o conteúdo do ScrollArea é block, não table", () => {
    render(
      <Page title="Sessões">
        <p>corpo</p>
      </Page>,
    );
    const area = document.querySelector("[data-slot='scroll-area']");
    expect(area?.className ?? "").toContain("[&_[data-slot=scroll-area-viewport]>div]:block!");
  });

  test("Configurações, Custos e as páginas do host ocupam a largura toda, sem divisor", async () => {
    const { store } = await setup();
    for (const name of ["settings", "host"] as const) {
      await act(async () => {
        store.router.push(
          name === "host"
            ? { name, host: store.getState().hosts[0]?.id ?? "" }
            : { name: "settings" },
        );
      });
      expect(within(main()).queryByRole("separator")).toBeNull();
    }
  });
});
