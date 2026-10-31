import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../daemon/test/board-helpers.ts";
import { userLine, writeTranscript } from "../../daemon/test/history-helpers.ts";
import { MIN_LOADING_MS, useMinLoading } from "../src/hooks/use-min-loading.ts";
import { translator } from "../src/i18n/index.ts";
import type { HostView } from "../src/lib/app-store.ts";
import type { ConnectionStatus } from "../src/lib/host-connection.ts";
import { hostStatusView, hostsBanner } from "../src/lib/host-status.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { HostStatusBadge } = await import("../src/components/hosts/host-status-badge.tsx");
const { AsyncButton } = await import("../src/components/feedback/busy.tsx");
const { ConfirmDialog } = await import("../src/ui/ConfirmDialog.tsx");

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

/** A button of the open confirmation (an alertdialog); the dialog itself is asserted. */
function inDialog(name: string): HTMLElement | null {
  const dialog = screen.queryByRole("alertdialog");
  expect(dialog).not.toBeNull();
  return within(dialog as HTMLElement).queryByRole("button", { name });
}

const alerts = () => screen.queryAllByRole("alert");
const alertTexts = () => alerts().map((a) => a.textContent ?? "");

async function online(language = "pt-BR") {
  const d = makeDaemon(cleanups);
  const mem = memoryPlatform(false, language);
  const copied: string[] = [];
  mem.platform.copyText = async (text) => {
    copied.push(text);
  };
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  return { d, store, copied, hostId: store.getState().hosts[0]?.id ?? "" };
}

/** The loading hook behind a paragraph, to watch it from outside. */
function Probe(props: { loading: boolean; timers: Parameters<typeof useMinLoading>[1] }) {
  return <p>{useMinLoading(props.loading, props.timers) ? "carregando" : "pronto"}</p>;
}

describe("estados-avisos", () => {
  test("erros viram toasts traduzidos pelo code, com Detalhes, e não se apagam uns aos outros", async () => {
    const { store, hostId } = await online();
    await act(async () => {
      await store.createSession(hostId, { cwd: "/fora/de/tudo", prompt: "oi" });
      await store.hostCommand(hostId, "card.get", { cardId: "nao-existe" });
    });
    await settle(() => alerts().length === 2);
    expect(alertTexts().join(" | ")).toContain("A pasta está fora das pastas permitidas do host.");
    expect(alertTexts().join(" | ")).toContain("Não encontrado no host.");
    const notFound = alerts().find((a) => (a.textContent ?? "").includes("Não encontrado"));
    // The daemon's own message is behind "Detalhes".
    expect(notFound?.textContent ?? "").not.toContain("nao-existe");
    const details = notFound ? within(notFound).queryByRole("button", { name: "Detalhes" }) : null;
    expect(details).not.toBeNull();
    await act(async () => {
      fireEvent.click(details as HTMLElement);
    });
    expect(notFound?.textContent ?? "").toContain("nao-existe");
    const close = notFound ? within(notFound).queryByRole("button", { name: "Fechar" }) : null;
    expect(close).not.toBeNull();
    await act(async () => {
      fireEvent.click(close as HTMLElement);
      await Bun.sleep(400);
    });
    await settle(() => alerts().length === 1);
    expect(alertTexts()).toEqual([expect.stringContaining("A pasta está fora")]);
  });

  test("código desconhecido mostra a mensagem do daemon; em inglês, os títulos também", async () => {
    const { store, hostId } = await online("en-US");
    await act(async () => {
      store.reportError("Link de pareamento recusado: porta inválida");
      await store.hostCommand(hostId, "card.get", { cardId: "x" });
    });
    await settle(() => alerts().length === 2);
    expect(alertTexts().join(" | ")).toContain("Link de pareamento recusado: porta inválida");
    expect(alertTexts().join(" | ")).toContain("Not found on the host.");
  });

  test("sucesso em toast curto: copiar o comando e iniciar um card", async () => {
    const { store, copied } = await online();
    await act(async () => {
      expect(await store.copyText("flightdeckd claude --resume x")).toBe(true);
    });
    expect(copied).toEqual(["flightdeckd claude --resume x"]);
    await settle(() => (document.body.textContent ?? "").includes("Copiado"));
    expect(document.body.textContent ?? "").toContain("Copiado");
    expect(alerts()).toEqual([]);
  });

  test("o carregamento, uma vez mostrado, fica ao menos 150 ms; já passado esse tempo, some na hora", async () => {
    let t = 0;
    const timeouts: Array<() => void> = [];
    const timers = {
      now: () => t,
      setTimeout: (fn: () => void) => timeouts.push(fn),
      clearTimeout: () => {},
    };
    expect(MIN_LOADING_MS).toBe(150);
    const view = render(<Probe loading={true} timers={timers} />);
    expect(screen.queryByText("carregando")).not.toBeNull();
    t = 50;
    view.rerender(<Probe loading={false} timers={timers} />);
    // Done after 50 ms: still showing until 150 ms have passed.
    expect(screen.queryByText("carregando")).not.toBeNull();
    t = 150;
    await act(async () => {
      for (const fn of timeouts.splice(0)) fn();
    });
    expect(screen.queryByText("pronto")).not.toBeNull();
    t = 200;
    view.rerender(<Probe loading={true} timers={timers} />);
    t = 400;
    view.rerender(<Probe loading={false} timers={timers} />);
    expect(screen.queryByText("pronto")).not.toBeNull();
  });

  test("a lista do histórico carrega com skeleton e some o skeleton só depois do mínimo", async () => {
    const d = makeDaemon(cleanups);
    writeTranscript(d.historyRoot, "-p", "hist-1", [
      userLine({
        uuid: "u1",
        text: "Do histórico",
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
    await settle(() => store.getState().hosts[0]?.status === "online");
    const hostId = store.getState().hosts[0]?.id ?? "";
    // When the skeleton mounts and unmounts, seen by the DOM itself: it can show inside the push.
    const shown: { at: number | null; gone: number | null } = { at: null, gone: null };
    const skeleton = '[role="status"][aria-label="Carregando sessões"]';
    const observer = new MutationObserver(() => {
      const present = document.querySelector(skeleton) !== null;
      if (present && shown.at === null) shown.at = performance.now();
      if (!present && shown.at !== null && shown.gone === null) shown.gone = performance.now();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    cleanups.push(() => observer.disconnect());
    await act(async () => store.router.push({ name: "history", host: hostId }));
    await settle(() => screen.queryByRole("list", { name: "Sessões do histórico" }) !== null);
    expect(screen.queryByRole("list", { name: "Sessões do histórico" })).not.toBeNull();
    expect(shown.at).not.toBeNull();
    expect((shown.gone ?? 0) - (shown.at ?? 0)).toBeGreaterThanOrEqual(100);
    expect(screen.queryByRole("status", { name: "Carregando sessões" })).toBeNull();
  });

  test("vazio com ação: histórico sem sessões, projetos sem projeto e board sem cards", async () => {
    const d = makeDaemon(cleanups);
    const repo = join(d.root, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "commit.gpgsign", "false");
    writeFileSync(join(repo, "README.md"), "# repo\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "inicial");
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    const hostId = store.getState().hosts[0]?.id ?? "";

    await act(async () => store.router.push({ name: "history", host: hostId }));
    await settle(() => screen.queryByText("Nenhuma sessão no histórico.") !== null);
    expect(screen.queryByText("Nenhuma sessão no histórico.")).not.toBeNull();
    // A pointer to where history comes from: a session, with a link to start one.
    expect(
      screen.queryByText("Comece uma sessão e ela entra aqui quando terminar."),
    ).not.toBeNull();
    const start = screen.queryByRole("button", { name: "Nova sessão" });
    expect(start).not.toBeNull();
    await act(async () => {
      fireEvent.click(start as HTMLElement);
    });
    expect(store.router.current).toEqual({ name: "new-session", host: hostId });
    await act(async () => store.router.push({ name: "history", host: hostId }));

    await act(async () => store.router.push({ name: "projects", host: hostId }));
    await settle(() => screen.queryByText("Nenhum projeto cadastrado.") !== null);
    const add = screen.queryByRole("button", { name: "Adicionar projeto" });
    expect(add).not.toBeNull();
    await act(async () => {
      fireEvent.click(add as HTMLElement);
    });
    expect(document.activeElement).toBe(screen.queryByLabelText("Caminho do repositório"));

    const project = await d.board.addProject({ path: repo, promptTemplate: "" });
    await act(async () =>
      store.router.push({ name: "board", host: hostId, projectId: project.id }),
    );
    await settle(() => screen.queryByText("Nenhum card neste projeto.") !== null);
    // The empty board's own action opens the new-card dialog, on its title.
    const first = screen.queryByRole("button", { name: "Criar o primeiro card" });
    expect(first).not.toBeNull();
    await act(async () => {
      fireEvent.click(first as HTMLElement);
    });
    expect(screen.queryByRole("dialog", { name: "Novo card" })).not.toBeNull();
    await settle(() => document.activeElement === screen.queryByLabelText("Título do card"));
    expect(document.activeElement).toBe(screen.queryByLabelText("Título do card"));
  });

  test("cada estado de conexão tem texto e cor próprios: offline e reconectando nunca se parecem", () => {
    const t = translator("pt-BR");
    const all: ConnectionStatus[] = [
      "online",
      "offline",
      "connecting",
      "unauthorized",
      "incompatible",
    ];
    expect(all.map((status) => hostStatusView(status, t))).toEqual([
      { label: "online", tone: "online" },
      { label: "offline", tone: "offline" },
      { label: "reconectando", tone: "reconnecting" },
      { label: "token recusado", tone: "refused" },
      { label: "incompatível: atualize o daemon", tone: "incompatible" },
    ]);
    render(
      <div>
        {all.map((status) => (
          <HostStatusBadge key={status} status={status} t={t} />
        ))}
      </div>,
    );
    const classOf = (label: string) => screen.queryByText(label)?.className ?? "";
    expect(classOf("offline")).toContain("text-status-idle");
    expect(classOf("reconectando")).toContain("text-status-needs-you");
    expect(classOf("offline")).not.toBe(classOf("reconectando"));
    expect(classOf("online")).toContain("text-status-idle");
  });

  test("a faixa do hub conta os hosts offline e os reconectando, sem esconder as sessões do resto", async () => {
    const host = (name: string, status: ConnectionStatus) =>
      ({ id: name, name, status }) as HostView;
    expect(
      hostsBanner([
        host("a", "online"),
        host("b", "offline"),
        host("c", "connecting"),
        host("d", "unauthorized"),
        host("e", "incompatible"),
      ]),
    ).toEqual({
      down: [host("b", "offline"), host("d", "unauthorized"), host("e", "incompatible")],
      reconnecting: [host("c", "connecting")],
    });

    const alfa = makeDaemon(cleanups);
    const { sessionId } = alfa.manager.create({ cwd: alfa.project, prompt: "oi", name: "Viva" });
    const closed = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    const deadUrl = `ws://127.0.0.1:${closed.port}/v1/ws`;
    closed.stop(true);
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: alfa.listen().url, token: TOKEN });
      await store.addHost({ name: "notebook", url: deadUrl, token: TOKEN });
      await store.addHost({ name: "servidor", url: deadUrl, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    await act(async () => store.router.push({ name: "hub" }));
    await settle(() => screen.queryByRole("status", { name: "Hosts com problema" }) !== null);
    const strip = screen.queryByRole("status", { name: "Hosts com problema" });
    // One compact line, open on click.
    expect(strip?.textContent ?? "").toContain("2 hosts com problema");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "2 hosts com problema" }));
    });
    expect(strip?.textContent ?? "").toContain("2 hosts offline");
    expect(strip?.textContent ?? "").toContain("notebook");
    expect(strip?.textContent ?? "").toContain("servidor");
    // The online host's sessions are still listed.
    await settle(() => screen.queryByRole("listitem", { name: "Viva" }) !== null);
    expect(screen.queryByRole("listitem", { name: "Viva" })).not.toBeNull();
    expect(sessionId).not.toBe("");
  });

  test("um botão em ação fica desabilitado, com spinner, e não aceita duplo clique", async () => {
    let release: () => void = () => {};
    const calls: number[] = [];
    render(
      <AsyncButton
        onClick={() => {
          calls.push(1);
          return new Promise<void>((resolve) => {
            release = resolve;
          });
        }}
      >
        Salvar
      </AsyncButton>,
    );
    const button = screen.queryByRole("button", { name: "Salvar" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(button);
    });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.querySelector("svg.animate-spin")).not.toBeNull();
    await act(async () => {
      fireEvent.click(button);
    });
    expect(calls).toEqual([1]);
    await act(async () => release());
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-busy")).toBeNull();
    expect(button.querySelector("svg.animate-spin")).toBeNull();
  });

  test("o formulário de host fica ocupado enquanto testa a conexão e adiciona uma vez só", async () => {
    const d = makeDaemon(cleanups);
    const url = new URL(d.listen().url.replace("ws://", "http://"));
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await settle(() => screen.queryByLabelText("Nome") !== null);
    for (const [label, value] of [
      ["Nome", "pc"],
      ["Endereço", url.hostname],
      ["Porta", url.port],
      ["Token", TOKEN],
    ] as const) {
      await act(async () => {
        fireEvent.change(screen.queryByLabelText(label) as HTMLElement, { target: { value } });
      });
    }
    const form = screen.queryByLabelText("Nome")?.closest("form") as HTMLFormElement;
    const submit = screen.queryByRole("button", {
      name: "Testar e adicionar",
    }) as HTMLButtonElement;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute("aria-busy")).toBe("true");
    await settle(() => store.getState().hosts.length > 0);
    await act(async () => Bun.sleep(100));
    expect(store.getState().hosts.map((h) => h.name)).toEqual(["pc"]);
  });

  test("confirmação em AlertDialog: foco preso, Esc cancela e o botão destrutivo é vermelho, com o verbo certo", async () => {
    const calls: string[] = [];
    render(
      <ConfirmDialog
        message="Remover o host alfa?"
        warning="As sessões dele somem da lista."
        confirmLabel="Remover host"
        destructive
        onConfirm={() => calls.push("confirm")}
        onCancel={() => calls.push("cancel")}
      />,
    );
    const dialog = screen.queryByRole("alertdialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent ?? "").toContain("Remover o host alfa?");
    expect(dialog?.textContent ?? "").toContain("As sessões dele somem da lista.");
    await settle(() => dialog?.contains(document.activeElement) === true);
    expect(dialog?.contains(document.activeElement)).toBe(true);
    const confirm = within(dialog as HTMLElement).queryByRole("button", { name: "Remover host" });
    expect(confirm?.className ?? "").toContain("bg-destructive");
    expect(
      within(dialog as HTMLElement).queryByRole("button", { name: "Cancelar" }),
    ).not.toBeNull();
    await act(async () => {
      fireEvent.keyDown(dialog as HTMLElement, { key: "Escape" });
    });
    expect(calls).toEqual(["cancel"]);
    await act(async () => {
      fireEvent.click(confirm as HTMLElement);
    });
    expect(calls).toEqual(["cancel", "confirm"]);
  });

  test("encerrar a sessão e remover o host pedem confirmação com o verbo certo; cancelar não faz nada", async () => {
    const { d, store, hostId } = await online();
    const { sessionId } = d.manager.create({ cwd: d.project, prompt: "oi", name: "Viva" });
    await settle(() => d.manager.get(sessionId).status === "idle");
    await act(async () => store.router.push({ name: "session", host: hostId, id: sessionId }));
    await settle(() => screen.queryByRole("button", { name: "Encerrar" }) !== null);

    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Encerrar" }) as HTMLElement);
    });
    let dialog = screen.queryByRole("alertdialog") as HTMLElement;
    expect(dialog?.textContent ?? "").toContain("Encerrar esta sessão?");
    expect(dialog).not.toBeNull();
    await act(async () => {
      fireEvent.click(inDialog("Cancelar") as HTMLElement);
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(d.manager.get(sessionId).status).toBe("idle");
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Encerrar" }) as HTMLElement);
    });
    dialog = screen.queryByRole("alertdialog") as HTMLElement;
    await act(async () => {
      fireEvent.click(inDialog("Encerrar sessão") as HTMLElement);
    });
    await settle(() => d.manager.get(sessionId).status === "ended");
    expect(d.manager.get(sessionId).status).toBe("ended");

    // The host: from its menu in the sidebar, no icon beside "+".
    expect(screen.queryByRole("button", { name: "Remover alfa" })).toBeNull();
    const menu = screen.queryByRole("button", { name: "Menu de alfa" }) as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(menu, { button: 0, ctrlKey: false, pointerType: "mouse" });
    });
    await act(async () => {
      fireEvent.click(screen.queryByRole("menuitem", { name: "Remover host" }) as HTMLElement);
    });
    dialog = screen.queryByRole("alertdialog") as HTMLElement;
    expect(dialog?.textContent ?? "").toContain("alfa");
    await act(async () => {
      fireEvent.click(inDialog("Cancelar") as HTMLElement);
    });
    expect(store.getState().hosts).toHaveLength(1);
    await act(async () => {
      fireEvent.pointerDown(menu, { button: 0, ctrlKey: false, pointerType: "mouse" });
    });
    await act(async () => {
      fireEvent.click(screen.queryByRole("menuitem", { name: "Remover host" }) as HTMLElement);
    });
    await act(async () => {
      fireEvent.click(
        within(screen.queryByRole("alertdialog") as HTMLElement).queryByRole("button", {
          name: "Remover host",
        }) as HTMLElement,
      );
    });
    expect(store.getState().hosts).toEqual([]);
  });

  test("na página do host, Remover host pede confirmação e Cancelar mantém o host", async () => {
    const { store, hostId } = await online();
    await act(async () => store.router.push({ name: "host", host: hostId }));
    await settle(() => screen.queryByRole("button", { name: "Remover host" }) !== null);
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Remover host" }) as HTMLElement);
    });
    expect(screen.queryByRole("alertdialog")).not.toBeNull();
    await act(async () => {
      fireEvent.click(inDialog("Cancelar") as HTMLElement);
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(store.getState().hosts).toHaveLength(1);
  });
});
