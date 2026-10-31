import { afterEach, describe, expect, test } from "bun:test";
import type { PendingPermission } from "@flightdeck/protocol";
import { visibleLiterals } from "../../../scripts/lib/i18n-sweep.ts";
import { en } from "../src/i18n/en.ts";
import { translateError } from "../src/i18n/errors.ts";
import {
  formatAgo,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatTime,
  formatUsd,
  formatWhen,
} from "../src/i18n/format.ts";
import { I18n, LANG_KEY, languageFor, translator } from "../src/i18n/index.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { summaryNotifications } from "../src/lib/notify.ts";
import { trayMenu, trayStatus } from "../src/lib/tray.ts";
import type { TrayMenu, TrayStatus } from "../src/platform/types.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { tauriPlatform } = await import("../src/platform/tauri/index.ts");

afterEach(() => {
  cleanup();
  document.documentElement.lang = "";
});

const ptT = translator("pt-BR");
const enT = translator("en");

/** Dotted keys of a dictionary, sorted. */
function keys(value: object, prefix = ""): string[] {
  return Object.entries(value)
    .flatMap(([k, v]) =>
      typeof v === "string" || "other" in v ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`),
    )
    .sort();
}

const pending = (n: number): PendingPermission[] =>
  Array.from({ length: n }, (_, i) => ({
    requestId: `r${i}`,
    toolName: "Bash",
    createdAt: "2026-10-29T10:00:00.000Z",
  }));

describe("i18n", () => {
  test("pt-BR e en com as mesmas chaves; idioma inicial pelo do sistema", () => {
    expect(keys(en)).toEqual(keys(ptBR));
    expect(keys(ptBR).length).toBeGreaterThan(40);
    expect(languageFor("pt-BR")).toBe("pt-BR");
    expect(languageFor("pt-PT")).toBe("pt-BR");
    expect(languageFor("pt")).toBe("pt-BR");
    expect(languageFor("en-US")).toBe("en");
    expect(languageFor("fr-FR")).toBe("en");
    expect(languageFor("")).toBe("en");
  });

  test("t interpola e escolhe o plural pelo Intl.PluralRules", () => {
    expect(ptT("tray.approve")).toBe("Aprovar");
    expect(enT("tray.approve")).toBe("Approve");
    expect(ptT("tray.more", { n: 3 })).toBe("e mais 3…");
    expect(enT("tray.more", { n: 3 })).toBe("and 3 more…");
    expect(ptT("tray.waiting", { n: 1, hosts: "pc: 1" })).toBe(
      "Flightdeck: 1 pedido esperando você (pc: 1)",
    );
    expect(ptT("tray.waiting", { n: 2, hosts: "pc: 2" })).toBe(
      "Flightdeck: 2 pedidos esperando você (pc: 2)",
    );
    expect(enT("tray.waiting", { n: 1, hosts: "pc: 1" })).toBe(
      "Flightdeck: 1 request waiting for you (pc: 1)",
    );
    // A missing variable stays visible instead of vanishing.
    expect(enT("tray.more")).toBe("and {n} more…");
  });

  test("the date formatters are built once per language and zone, not once per call", () => {
    const iso = "2026-10-29T15:04:00.000Z";
    const nowMs = Date.parse("2026-10-30T12:00:00.000Z");
    const Real = Intl.DateTimeFormat;
    let built = 0;
    Intl.DateTimeFormat = new Proxy(Real, {
      construct(target, args) {
        built += 1;
        return Reflect.construct(target, args);
      },
    });
    try {
      const run = () => {
        formatTime(iso, "en", "UTC");
        formatDateTime(iso, "en", "UTC");
        formatWhen(iso, nowMs, "en", "UTC");
      };
      run();
      const afterFirst = built;
      for (let i = 0; i < 50; i += 1) run();
      expect(built).toBe(afterFirst);
    } finally {
      Intl.DateTimeFormat = Real;
    }
  });

  test("datas e horas locais, números, dólares e durações legíveis", () => {
    const iso = "2026-10-29T15:04:00.000Z";
    expect(formatTime(iso, "pt-BR", "America/Sao_Paulo")).toBe("12:04");
    expect(formatTime(iso, "en", "America/Sao_Paulo")).toBe("12:04 PM");
    expect(formatDateTime(iso, "pt-BR", "America/Sao_Paulo")).toBe("29/10/2026, 12:04");
    expect(formatDateTime(iso, "en", "America/Sao_Paulo")).toBe("Oct 29, 2026, 12:04 PM");
    // Without a time zone: this machine's (local), never UTC.
    const local = new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    expect(formatTime(iso, "pt-BR")).toBe(local);
    expect(formatNumber(1234.5, "pt-BR")).toBe("1.234,5");
    expect(formatNumber(1234.5, "en")).toBe("1,234.5");
    expect(formatUsd(3.5, "en")).toBe("$3.50");
    expect(formatUsd(3.5, "pt-BR")).toBe("US$ 3,50");
    expect(formatDuration(125 * 60_000, ptT)).toBe("2 h 5 min");
    expect(formatDuration(120 * 60_000, ptT)).toBe("2 h");
    expect(formatDuration(3 * 60_000 + 10_000, ptT)).toBe("3 min");
    expect(formatDuration(45_000, enT)).toBe("45 s");
    expect(formatAgo(3 * 60_000, ptT)).toBe("há 3 min");
    expect(formatAgo(3 * 60_000, enT)).toBe("3 min ago");
    expect(formatAgo(20_000, ptT)).toBe("agora");
  });

  test("the credential and connection errors say what to run, in both languages", () => {
    for (const t of [ptT, enT]) {
      expect(translateError("unauthorized", "x", t).title).toContain("flightdeckd pair");
      expect(translateError("offline", "x", t).title).toContain("flightdeckd start");
    }
  });

  test("erros do daemon traduzidos pelo code, com a mensagem como detalhe; código desconhecido usa a mensagem", () => {
    expect(translateError("invalid_state", "sessão possivelmente em uso", ptT)).toEqual({
      title: "Não dá para fazer isso agora.",
      detail: "sessão possivelmente em uso",
    });
    expect(translateError("offline", "host desconhecido", enT)).toEqual({
      title:
        "The host is offline: check that the daemon runs there (flightdeckd start) and that the network reaches its address.",
      detail: "host desconhecido",
    });
    expect(translateError("quota_exceeded", "cota estourada", enT)).toEqual({
      title: "cota estourada",
      detail: "",
    });
  });

  test("bandeja e notificações saem do mesmo dicionário", () => {
    const hosts = [{ name: "pc", sessions: [{ pendingPermissions: pending(2) }] }];
    expect(trayStatus(hosts, enT)).toEqual({
      count: 2,
      label: "Needs you (2)",
      tooltip: "Flightdeck: 2 requests waiting for you (pc: 2)",
    } satisfies TrayStatus);
    expect(trayStatus([], ptT)).toEqual({
      count: 0,
      label: "Precisa de você (0)",
      tooltip: "Flightdeck: nada esperando você",
    });
    const items = Array.from({ length: 12 }, (_, i) => ({
      hostId: "h1",
      hostName: "pc",
      sessionId: "s",
      sessionName: "api",
      requestId: `r${i}`,
      toolName: "Read",
      createdAt: "2026-10-29T10:00:00.000Z",
    }));
    const menu: TrayMenu = trayMenu(items, enT);
    expect(menu.labels).toEqual({
      approve: "Approve",
      deny: "Deny",
      open: "Open",
      more: "and 2 more…",
      empty: "Nothing waiting for you",
      show: "Open",
      quit: "Quit",
    });
    const prev = { status: "running" as const, pendingPermissions: [] };
    const next = { status: "idle" as const, pendingPermissions: pending(1) };
    expect(summaryNotifications(prev, next, "pc · api", false, undefined, enT)).toEqual([
      { title: "pc · api: needs you", body: "Allow Bash?" },
      { title: "pc · api: turn finished", body: "idle" },
    ]);
  });

  test("o idioma do sistema vem do navigator, no app desktop e na versão web", () => {
    const win = {
      localStorage: { getItem: () => null, setItem: () => {} },
      document: { hasFocus: () => true },
      navigator: { language: "pt-PT", clipboard: { writeText: async () => {} } },
    };
    expect(tauriPlatform(win).systemLanguage()).toBe("pt-PT");
    expect(memoryPlatform(false, "en-GB").platform.systemLanguage()).toBe("en-GB");
  });

  test("o idioma guardado vence o do sistema; trocar não pede reinício e muda o lang do html", () => {
    const mem = memoryPlatform(false, "en-GB");
    const i18n = new I18n(mem.platform);
    let changes = 0;
    i18n.subscribe(() => changes++);
    i18n.start();
    expect(i18n.lang).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(i18n.t("tray.quit")).toBe("Quit");
    i18n.setLang("pt-BR");
    expect(i18n.t("tray.quit")).toBe("Sair");
    expect(document.documentElement.lang).toBe("pt-BR");
    expect(mem.items.get(LANG_KEY)).toBe("pt-BR");
    expect(changes).toBe(1);
    const again = new I18n(mem.platform);
    again.start();
    expect(again.lang).toBe("pt-BR");
  });

  test("Configurações e a paleta trocam o idioma; a bandeja acompanha na hora", async () => {
    const mem = memoryPlatform(false, "pt-BR");
    const statuses: TrayStatus[] = [];
    const menus: TrayMenu[] = [];
    mem.platform.setTrayStatus = async (status) => {
      statuses.push(status);
    };
    mem.platform.setTrayMenu = async (menu) => {
      menus.push(menu);
    };
    const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => Bun.sleep(5));
    expect(document.documentElement.lang).toBe("pt-BR");
    const settings = screen.queryByRole("button", { name: "Configurações" });
    expect(settings).not.toBeNull();
    await act(async () => {
      fireEvent.click(settings as HTMLElement);
    });
    const select = screen.queryByLabelText("Idioma") as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect([...(select?.options ?? [])].map((o) => o.textContent)).toEqual([
      "Português (Brasil)",
      "English",
    ]);
    await act(async () => {
      fireEvent.change(select as HTMLSelectElement, { target: { value: "en" } });
    });
    expect(document.documentElement.lang).toBe("en");
    expect(statuses.at(-1)?.tooltip).toBe("Flightdeck: nothing waiting for you");
    expect(menus.at(-1)?.labels.quit).toBe("Quit");

    await act(async () => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    // The palette speaks English now, its field too.
    const input = screen.queryByLabelText("Search the history") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    await act(async () => {
      fireEvent.change(input as HTMLInputElement, { target: { value: "language" } });
    });
    await act(async () => {
      fireEvent.keyDown(input as HTMLInputElement, { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(input as HTMLInputElement, { key: "Enter" });
    });
    expect(store.i18n.lang).toBe("pt-BR");
    expect(document.documentElement.lang).toBe("pt-BR");
    expect(menus.at(-1)?.labels.quit).toBe("Sair");
    store.dispose();
  });

  test("varredura de literais: texto visível fora do dicionário, com exceções", () => {
    const source = [
      "<h2>Sessões</h2>",
      '<button aria-label="Fechar" title={t("x")}>{t("close")}</button>',
      '<input placeholder="Filtrar" />',
      "<span>{`${n} itens`}</span>",
      "<span>Flightdeck</span>",
      "<code>{command}</code>",
      "<span> · </span>",
    ].join("\n");
    expect(visibleLiterals(source, ["Flightdeck"])).toEqual([
      { line: 1, text: "Sessões" },
      { line: 2, text: 'aria-label="Fechar"' },
      { line: 3, text: 'placeholder="Filtrar"' },
      { line: 4, text: "{`${n} itens`}" },
    ]);
  });

  test("varredura de literais: texto em várias linhas e as propriedades que o usuário lê", () => {
    const source = [
      "<Button>",
      "  Salvar nome",
      "</Button>",
      '<Page title="Custos" subtitle="em dólar" />',
      '<ConfirmDialog message="Apagar?" confirmLabel="Apagar" />',
      '<Foo label="Host" id="x" />',
      "if (a > b && c < d) run();",
      '<p>{t("a")}</p>',
      // Ids and keys are not text: no space and no accent in what is left of the template.
      "<label htmlFor={`${id}-sub`} key={`row-${i}`}>{`custo ${n}`}</label>",
    ].join("\n");
    expect(visibleLiterals(source)).toEqual([
      { line: 2, text: "Salvar nome" },
      { line: 4, text: 'title="Custos"' },
      { line: 4, text: 'subtitle="em dólar"' },
      { line: 5, text: 'message="Apagar?"' },
      { line: 5, text: 'confirmLabel="Apagar"' },
      { line: 6, text: 'label="Host"' },
      { line: 9, text: "{`custo ${n}`}" },
    ]);
  });
});
