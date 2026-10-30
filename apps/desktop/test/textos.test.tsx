import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { visibleLiterals } from "../../../scripts/lib/i18n-sweep.ts";
import { poll } from "../../daemon/test/helpers.ts";
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
const { useT, TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const ROOT = resolve(import.meta.dir, "../../..");

/** Every screen and component with text: all of it comes from the dictionary. */
const SOURCES = [
  "src/ui",
  "src/components/approval",
  "src/components/feedback",
  "src/components/hosts",
  "src/components/layout",
  "src/components/session",
  "src/components/status",
].flatMap((dir) =>
  readdirSync(resolve(import.meta.dir, "..", dir))
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => resolve(import.meta.dir, "..", dir, file)),
);
/** Names and ids that are not translated. */
const ALLOWED = ["Flightdeck", "Ctrl K", "flightdeck://…"];

async function online(language: string) {
  const d = makeDaemon(cleanups);
  const { sessionId } = d.manager.create({ cwd: d.project, prompt: "oi", name: "Alpha" });
  await poll(() => d.manager.get(sessionId).status === "idle");
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await act(() => Bun.sleep(300));
  return { d, store, sessionId, hostId: store.getState().hosts[0]?.id ?? "" };
}

/** Shows one word from the dictionary of the language in use. */
function Probe() {
  return <p>{useT()("sidebar.sessions")}</p>;
}

const main = () => screen.queryByRole("main") as HTMLElement;

describe("textos", () => {
  test("o glossário existe e fixa os termos nos dois idiomas", () => {
    const path = resolve(ROOT, "docs/GLOSSARY.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    for (const term of ["Aprovar", "Negar", "Precisa de você", "sessão do terminal", "card"]) {
      expect(text).toContain(term);
    }
    for (const term of ["Approve", "Deny", "Needs you", "terminal session"]) {
      expect(text).toContain(term);
    }
  });

  test("as telas varridas não têm texto visível fora do dicionário", () => {
    const left = SOURCES.flatMap((file) =>
      visibleLiterals(readFileSync(file, "utf8"), ALLOWED).map(
        (l) => `${file.slice(file.indexOf("src"))}:${l.line} ${l.text}`,
      ),
    );
    expect(left).toEqual([]);
  });

  test("useT segue o idioma do app e cai no português fora dele", () => {
    render(<Probe />);
    expect(screen.queryByText("Sessões")).not.toBeNull();
    cleanup();
    render(
      <TContext.Provider value={translator("en")}>
        <Probe />
      </TContext.Provider>,
    );
    expect(screen.queryByText("Sessions")).not.toBeNull();
  });

  test("os modos de permissão têm nome legível e uma linha de explicação; o valor técnico não aparece", async () => {
    const { store, hostId } = await online("pt-BR");
    await act(async () => {
      store.router.push({ name: "new-session", host: hostId });
    });
    const select = screen.queryByLabelText("Modo de permissão") as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Padrão: pergunta antes de agir",
      "Aceitar edições: edita arquivos sem perguntar",
      "Planejar: só lê e propõe um plano",
      "Automático: um classificador decide o que segue",
      "Só o permitido: nega o que as regras não liberam",
      "Sem perguntas: executa tudo, sem pedir aprovação",
    ]);
    const text = main().textContent ?? "";
    for (const technical of ["bypassPermissions", "acceptEdits", "dontAsk"]) {
      expect(text).not.toContain(technical);
    }
    // The risky one warns, in red.
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => {
      fireEvent.change(select, { target: { value: "bypassPermissions" } });
    });
    const warning = screen.queryByRole("alert");
    expect(warning?.textContent).toContain("Sem perguntas");
    expect(warning?.className ?? "").toContain("text-status-error");
    await act(async () => {
      fireEvent.change(select, { target: { value: "plan" } });
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("em inglês, a sessão nova, a conversa e o leitor falam inglês e não mostram termos internos", async () => {
    const { store, hostId, sessionId } = await online("en");
    await act(async () => {
      store.router.push({ name: "new-session", host: hostId });
    });
    const english = [
      "Folder",
      "Subfolder",
      "Name",
      "Permission mode",
      "First prompt",
      "Create session",
    ];
    for (const label of english) expect(main().textContent ?? "").toContain(label);
    expect(main().textContent ?? "").not.toMatch(/Pasta|Subpasta|Modo de|Primeiro|Criar sessão/);
    const select = screen.queryByLabelText("Permission mode") as HTMLSelectElement;
    expect([...select.options][0]?.textContent).toBe("Default: asks before acting");
    await act(async () => {
      store.router.push({ name: "session", host: hostId, id: sessionId });
    });
    await act(() => Bun.sleep(200));
    const session = main().textContent ?? "";
    for (const word of ["Interrupt", "End", "Send", "Copy command", "idle"]) {
      expect(session).toMatch(new RegExp(word));
    }
    expect(session).not.toMatch(/Retomar|Interromper|Encerrar|Enviar|Mensagem/);
    // The turn's line has no internal "subtype": a word and the time.
    expect(session).not.toMatch(/success|subtype/);
  });

  test("em inglês, projetos, board e workflows falam inglês", async () => {
    const { store, hostId } = await online("en");
    await act(async () => {
      store.router.push({ name: "projects", host: hostId });
    });
    await act(() => Bun.sleep(300));
    const page = main().textContent ?? "";
    for (const text of [
      "Projects of alfa",
      "New project",
      "Register project",
      "Host limit",
      "Save limit",
    ]) {
      expect(page).toContain(text);
    }
    expect(page).not.toMatch(/Projetos|Novo projeto|Cadastrar|Limite do host|Salvar limite/);
    expect(screen.queryByLabelText("Repository path")).not.toBeNull();
    expect(screen.queryByLabelText("PR provider")).not.toBeNull();
    await act(async () => {
      store.router.push({ name: "projects", host: hostId, focus: "board" });
    });
    await act(() => Bun.sleep(300));
    expect(main().textContent ?? "").toContain("Board of alfa");
  });

  test("em inglês, Configurações e a página do host falam inglês", async () => {
    const { store, hostId } = await online("en");
    await act(async () => {
      store.router.push({ name: "settings" });
    });
    const prefs = main().textContent ?? "";
    for (const text of [
      "Appearance",
      "Window",
      "Closing the window sends it to the tray",
      "Global shortcut",
      "Save shortcut",
    ]) {
      expect(prefs).toContain(text);
    }
    expect(prefs).not.toMatch(/Aparência|Janela|Atalho|Salvar|Fechar a janela/);
    await act(async () => {
      store.router.push({ name: "host", host: hostId });
    });
    await act(() => Bun.sleep(300));
    const host = main().textContent ?? "";
    for (const text of [
      "Information",
      "Claude Code hooks",
      "Host name",
      "Save name",
      "Reconnect",
      "Remove host",
    ]) {
      expect(host).toContain(text);
    }
    expect(host).not.toMatch(/Informações|Reconectar|Remover host|Nome do host/);
    expect(host).toMatch(/up for \d+ s/);
  });

  test("termos internos nunca aparecem nas telas principais (lista proibida)", async () => {
    const { store, hostId } = await online("pt-BR");
    const forbidden = [
      "bypassPermissions",
      "acceptEdits",
      "dontAsk",
      "allowedRoots",
      "subtype",
      "claudeSessionId",
      "awaiting_permission",
      "needs_you",
      "pendingPermissions",
    ];
    await sidebar.openHub();
    const routes = [
      { name: "hub" },
      { name: "settings" },
      { name: "host", host: hostId },
      { name: "projects", host: hostId },
      { name: "new-session", host: hostId },
      { name: "history", host: hostId },
    ] as const;
    for (const route of routes) {
      await act(async () => {
        store.router.push(route);
      });
      await act(() => Bun.sleep(150));
      // What is read: the text and the attributes that are spoken or shown.
      const attributes = [...document.querySelectorAll("[placeholder], [aria-label], [title]")]
        .map(
          (el) =>
            `${el.getAttribute("placeholder")} ${el.getAttribute("aria-label")} ${el.getAttribute("title")}`,
        )
        .join(" ");
      const text = `${document.body.textContent ?? ""} ${attributes}`;
      for (const term of forbidden)
        expect(`${route.name}: ${text.includes(term)}`).toBe(`${route.name}: false`);
    }
  });
});
