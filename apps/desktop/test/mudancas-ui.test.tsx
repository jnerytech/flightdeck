import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../daemon/test/board-helpers.ts";
import { poll } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { EditorView } = await import("@codemirror/view");
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

// Real git and a real watcher under the in-process daemon: more than the default 5 s.
setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 6000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const click = async (name: string | RegExp) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

const type = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label) as HTMLInputElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLInputElement, { target: { value } });
  });
};

const text = (name: string) => screen.queryByRole("list", { name })?.textContent ?? "";
const files = () => text("Arquivos alterados");
const dialog = () => screen.queryByRole("alertdialog");

/** A host with a git repository inside its allowed root and a session working in it. */
async function setup(features?: string[]) {
  const d = makeDaemon(cleanups, { review: true });
  const repo = join(d.root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# repo\nlinha dois\nlinha três\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  const server = d.listen(0, undefined, features);
  const mem = memoryPlatform();
  const clock = { offset: 0 };
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const store = new AppStore(mem.platform, {
    baseDelayMs: 60_000,
    now: () => Date.now() + clock.offset,
    timers: {
      setTimeout: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimeout: () => {},
    },
  });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id ?? "";
  return { ...d, ...mem, repo, store, hostId, clock, timers };
}

/** Opens the managed session working in `cwd` (its Claude id is known once the first turn ran). */
async function openSession(ctx: Awaited<ReturnType<typeof setup>>, cwd = ctx.repo) {
  const { sessionId } = ctx.manager.create({ cwd, prompt: "oi", name: "Revisão" });
  const claudeId = await poll(() => ctx.manager.get(sessionId).claudeSessionId);
  await poll(() => ctx.manager.get(sessionId).status === "idle");
  await act(async () => {
    ctx.store.router.push({ name: "session", host: ctx.hostId, id: sessionId });
  });
  await settle(() => screen.queryByRole("heading", { name: "Revisão" }) !== null);
  return { sessionId, claudeId: claudeId as string };
}

const openChanges = async () => {
  await click("Mudanças");
  await settle(() => screen.queryByRole("region", { name: "Mudanças" }) !== null);
};

describe("mudancas-ui", () => {
  test("a aba Mudanças da sessão lista os arquivos, mostra o diff e acompanha o disco", async () => {
    const ctx = await setup();
    writeFileSync(join(ctx.repo, "README.md"), "# repo\nlinha DOIS\nlinha três\n");
    writeFileSync(join(ctx.repo, "novo.txt"), "um\ndois\n");
    writeFileSync(join(ctx.repo, "imagem.bin"), Buffer.from([0, 1, 2, 0, 255]));
    await openSession(ctx);
    expect(screen.queryByRole("region", { name: "Mudanças" })).toBeNull();
    await openChanges();
    await settle(() => files().includes("novo.txt"));
    expect(files()).toContain("README.md");
    expect(files()).toContain("novo.txt");
    expect(files()).toContain("+2 −0");
    expect(files()).toContain("Binário");
    expect(screen.queryByRole("region", { name: "Diff unificado" })?.textContent ?? "").toContain(
      "+linha DOIS",
    );
    expect(screen.queryByRole("region", { name: "Diff unificado" })?.textContent ?? "").toContain(
      "Arquivo binário: sem diff.",
    );
    await click("Lado a lado");
    expect(screen.queryByRole("region", { name: "Diff lado a lado" })).not.toBeNull();
    await click("Unificada");

    // The watcher (500 ms debounce): a file written meanwhile shows up with no click.
    writeFileSync(join(ctx.repo, "depois.txt"), "chegou\n");
    await settle(() => files().includes("depois.txt"));
    expect(files()).toContain("depois.txt");
    // The button asks again.
    writeFileSync(join(ctx.repo, "manual.txt"), "à mão\n");
    await click("Atualizar");
    await settle(() => files().includes("manual.txt"));
    expect(files()).toContain("manual.txt");
  });

  test("a aba só aparece em um host que anuncia a revisão, e explica uma pasta fora do git", async () => {
    const old = await setup(["rules"]);
    await openSession(old);
    expect(screen.queryByRole("button", { name: "Mudanças" })).toBeNull();
    cleanup();

    const ctx = await setup();
    const outside = join(ctx.root, "solta");
    mkdirSync(outside);
    await openSession(ctx, outside);
    await openChanges();
    await settle(() => screen.queryByText(/não está num repositório git/) !== null);
    expect(screen.queryByText(/não está num repositório git/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Enviar revisão" })).toBeNull();
  });

  test("comenta uma linha e um intervalo, edita e remove rascunhos e envia a revisão ao agente", async () => {
    const ctx = await setup();
    writeFileSync(join(ctx.repo, "novo.txt"), "um\ndois\ntrês\nquatro\n");
    await openSession(ctx);
    await openChanges();
    await settle(() => files().includes("novo.txt"));
    expect(screen.queryByRole("button", { name: /^Enviar revisão/ })).toBeNull();

    // One line: the composer names the lines; Cancelar leaves nothing behind.
    await click("Comentar a linha 2 de novo.txt");
    expect(screen.queryByRole("form", { name: "Novo comentário" })?.textContent ?? "").toContain(
      "novo.txt · linha 2",
    );
    await click("Cancelar");
    expect(screen.queryByRole("form", { name: "Novo comentário" })).toBeNull();

    await click("Comentar a linha 2 de novo.txt");
    await type("Comentário", "troque por outro nome");
    await click("Adicionar comentário");
    await settle(() =>
      (screen.queryByRole("list", { name: "Comentários da revisão" })?.textContent ?? "").includes(
        "outro nome",
      ),
    );
    expect(text("Comentários da revisão")).toContain("novo.txt");
    expect(text("Comentários da revisão")).toContain("dois");
    expect(text("Comentários da revisão")).toContain("Rascunho");

    // A range: a click, then shift+click on another line.
    await click("Comentar a linha 3 de novo.txt");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Comentar a linha 4 de novo.txt" }), {
        shiftKey: true,
      });
    });
    expect(screen.queryByRole("form", { name: "Novo comentário" })?.textContent ?? "").toContain(
      "novo.txt · linhas 3–4",
    );
    await type("Comentário", "esses dois sobram");
    await click("Adicionar comentário");
    await settle(() => text("Comentários da revisão").includes("sobram"));

    // Edit one draft, remove another.
    await click("Editar o comentário em novo.txt");
    await type("Texto do comentário", "troque pelo nome certo");
    await click("Salvar comentário");
    await settle(() => text("Comentários da revisão").includes("nome certo"));
    expect(text("Comentários da revisão")).not.toContain("troque por outro nome");
    await click(/^Remover o comentário em novo.txt/);
    await settle(
      () =>
        !text("Comentários da revisão").includes("nome certo") ||
        !text("Comentários da revisão").includes("sobram"),
    );
    expect(ctx.eventStore.db.query("SELECT count(*) AS n FROM review_comments").get()).toEqual({
      n: 1,
    });

    // Send: it reaches the session as a message and the draft becomes history.
    await click(/^Enviar revisão \(1\)/);
    await settle(() => text("Comentários da revisão").includes("Enviado"));
    expect(text("Comentários da revisão")).toContain("Enviado");
    expect(screen.queryByRole("button", { name: /^Enviar revisão/ })).toBeNull();
    await click("Conversa");
    await settle(() => document.body.textContent?.includes("Revisão das mudanças:") ?? false);
    expect(document.body.textContent ?? "").toContain("Revisão das mudanças:");
    expect(document.body.textContent ?? "").toContain("novo.txt");
  });

  test("um comentário cujo trecho sumiu fica desatualizado", async () => {
    const ctx = await setup();
    writeFileSync(join(ctx.repo, "novo.txt"), "um\ndois\ntrês\n");
    await openSession(ctx);
    await openChanges();
    await settle(() => files().includes("novo.txt"));
    await click("Comentar a linha 2 de novo.txt");
    await type("Comentário", "dois está errado");
    await click("Adicionar comentário");
    await settle(() => text("Comentários da revisão").includes("errado"));
    expect(text("Comentários da revisão")).not.toContain("Desatualizado");
    writeFileSync(join(ctx.repo, "novo.txt"), "um\n2\ntrês\n");
    await settle(() => text("Comentários da revisão").includes("Desatualizado"));
    expect(text("Comentários da revisão")).toContain("Desatualizado");
  });

  test("a sessão do terminal que não aceita mensagens recebe a revisão para copiar", async () => {
    const ctx = await setup();
    writeFileSync(join(ctx.repo, "novo.txt"), "um\ndois\n");
    ctx.central.external.apply("SessionStart", { session_id: "externa-1", cwd: ctx.repo });
    await act(async () => {
      await ctx.store.refreshHub();
      ctx.store.router.push({ name: "external", host: ctx.hostId, claudeSessionId: "externa-1" });
    });
    const copied: string[] = [];
    ctx.platform.copyText = async (value) => {
      copied.push(value);
    };
    await settle(() => screen.queryByRole("button", { name: "Mudanças" }) !== null);
    await openChanges();
    await settle(() => files().includes("novo.txt"));
    await click("Comentar a linha 1 de novo.txt");
    await type("Comentário", "revise isto");
    await click("Adicionar comentário");
    await settle(() => text("Comentários da revisão").includes("revise isto"));
    await click(/^Enviar revisão/);
    await settle(() => copied.length === 1);
    expect(copied[0]).toContain("Revisão das mudanças:");
    expect(copied[0]).toContain("revise isto");
    expect(text("Comentários da revisão")).toContain("Enviado");
    expect(document.body.textContent ?? "").toContain("A sessão não recebe mensagens");
  });

  test("reverter pede confirmação, guarda a cópia e oferece desfazer por 30 s", async () => {
    const ctx = await setup();
    writeFileSync(join(ctx.repo, "README.md"), "# repo\nlinha DOIS\nlinha três\n");
    writeFileSync(join(ctx.repo, "novo.txt"), "um\n");
    await openSession(ctx);
    await openChanges();
    await settle(() => files().includes("novo.txt"));

    await click("Reverter novo.txt");
    expect(dialog()?.textContent ?? "").toContain("Reverter novo.txt?");
    expect(dialog()?.textContent ?? "").toContain("7 dias");
    await click("Cancelar");
    expect(dialog()).toBeNull();
    expect(readFileSync(join(ctx.repo, "novo.txt"), "utf8")).toBe("um\n");

    await click("Reverter novo.txt");
    await click("Reverter arquivo");
    await settle(() => !files().includes("novo.txt"));
    expect(files()).not.toContain("novo.txt");
    expect(screen.queryByRole("status")?.textContent ?? "").toContain("novo.txt revertido");
    expect(() => readFileSync(join(ctx.repo, "novo.txt"))).toThrow();

    await click("Desfazer");
    await settle(() => files().includes("novo.txt"));
    expect(readFileSync(join(ctx.repo, "novo.txt"), "utf8")).toBe("um\n");
    expect(screen.queryByRole("button", { name: "Desfazer" })).toBeNull();

    // A tracked file goes back to HEAD; once the 30 s pass the undo is no longer offered.
    await click("Reverter README.md");
    await click("Reverter arquivo");
    await settle(() => !files().includes("README.md"));
    expect(readFileSync(join(ctx.repo, "README.md"), "utf8")).toBe(
      "# repo\nlinha dois\nlinha três\n",
    );
    expect(screen.queryByRole("button", { name: "Desfazer" })).not.toBeNull();
    ctx.clock.offset = 31_000;
    const expiry = ctx.timers.filter((t) => t.ms > 20_000 && t.ms <= 31_000).at(-1);
    expect(expiry).toBeDefined();
    await act(async () => {
      expiry?.fn();
    });
    expect(screen.queryByRole("button", { name: "Desfazer" })).toBeNull();
  });

  test("editar abre o arquivo, grava pelo hash e mostra o conflito quando o disco mudou", async () => {
    const ctx = await setup();
    writeFileSync(join(ctx.repo, "novo.txt"), "um\ndois\n");
    writeFileSync(join(ctx.repo, "imagem.bin"), Buffer.from([0, 1, 2, 0, 255]));
    await openSession(ctx);
    await openChanges();
    await settle(() => files().includes("novo.txt"));
    expect(screen.queryByRole("button", { name: "Editar arquivo imagem.bin" })).toBeNull();

    const editor = () => {
      const content = document.querySelector(".cm-content");
      return content ? EditorView.findFromDOM(content as HTMLElement) : null;
    };
    const write = async (value: string) => {
      const view = editor();
      expect(view).not.toBeNull();
      await act(async () => {
        view?.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
      });
    };

    await click("Editar arquivo novo.txt");
    await settle(() => editor() !== null && editor()?.state.doc.toString() === "um\ndois\n");
    expect(editor()?.state.doc.toString()).toBe("um\ndois\n");
    await write("um\nDOIS\n");
    await click("Salvar");
    await settle(() => readFileSync(join(ctx.repo, "novo.txt"), "utf8") === "um\nDOIS\n");
    expect(readFileSync(join(ctx.repo, "novo.txt"), "utf8")).toBe("um\nDOIS\n");
    await settle(() =>
      (screen.queryByRole("region", { name: "Diff unificado" })?.textContent ?? "").includes(
        "+DOIS",
      ),
    );

    // Someone else wrote the file meanwhile: Salvar shows the conflict and writes nothing.
    await write("um\nDOIS\ntrês meu\n");
    writeFileSync(join(ctx.repo, "novo.txt"), "um\nDOIS\nde outro\n");
    await click("Salvar");
    await settle(() => screen.queryByText("O arquivo mudou no disco depois de aberto.") !== null);
    expect(screen.queryByText("O arquivo mudou no disco depois de aberto.")).not.toBeNull();
    expect(readFileSync(join(ctx.repo, "novo.txt"), "utf8")).toBe("um\nDOIS\nde outro\n");

    // "Recarregar do disco" drops the edit and takes the disk's text...
    await click("Recarregar do disco");
    await settle(() => editor()?.state.doc.toString() === "um\nDOIS\nde outro\n");
    expect(editor()?.state.doc.toString()).toBe("um\nDOIS\nde outro\n");
    expect(screen.queryByText("O arquivo mudou no disco depois de aberto.")).toBeNull();

    // ...and "Sobrescrever" writes my version over what changed.
    await write("minha versão\n");
    writeFileSync(join(ctx.repo, "novo.txt"), "mudou de novo\n");
    await click("Salvar");
    await settle(() => screen.queryByText("O arquivo mudou no disco depois de aberto.") !== null);
    await click("Sobrescrever com a minha versão");
    await settle(() => readFileSync(join(ctx.repo, "novo.txt"), "utf8") === "minha versão\n");
    expect(readFileSync(join(ctx.repo, "novo.txt"), "utf8")).toBe("minha versão\n");
    await click("Fechar");
    expect(screen.queryByRole("dialog", { name: "Editar novo.txt" })).toBeNull();
  });

  test("um arquivo grande demais para editar mostra o motivo no lugar do editor", async () => {
    const ctx = await setup();
    writeFileSync(join(ctx.repo, "grande.txt"), "x".repeat(1_100_000));
    await openSession(ctx);
    await openChanges();
    await settle(() => files().includes("grande.txt"));
    await click("Editar arquivo grande.txt");
    await settle(() => screen.queryByText(/passa de 1 MB/) !== null);
    expect(screen.queryByText(/passa de 1 MB/)).not.toBeNull();
    expect(document.querySelector(".cm-content")).toBeNull();
  });

  test("Sessões que mexeram aqui lista as sessões que gravaram o arquivo", async () => {
    const ctx = await setup();
    writeFileSync(join(ctx.repo, "novo.txt"), "um\n");
    ctx.eventStore.db
      .query(
        "INSERT INTO session_files (claude_session_id, path, edits, first_at, last_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        "antiga-1",
        join(ctx.repo, "novo.txt"),
        3,
        "2026-10-01T10:00:00.000Z",
        "2026-10-02T10:00:00.000Z",
      );
    await openSession(ctx);
    await openChanges();
    await settle(() => files().includes("novo.txt"));

    await click("Sessões que mexeram em novo.txt");
    await settle(() => screen.queryByRole("list", { name: "Sessões que mexeram aqui" }) !== null);
    expect(text("Sessões que mexeram aqui")).toContain("antiga-1");
    expect(text("Sessões que mexeram aqui")).toContain("3 edições");
    cleanup();

    const empty = await setup();
    writeFileSync(join(empty.repo, "outro.txt"), "um\n");
    await openSession(empty);
    await openChanges();
    await settle(() => files().includes("outro.txt"));
    await click("Sessões que mexeram em outro.txt");
    await settle(
      () => screen.queryByText("Nenhuma sessão registrou edição neste arquivo.") !== null,
    );
    expect(screen.queryByText("Nenhuma sessão registrou edição neste arquivo.")).not.toBeNull();
  });

  test("sair da aba para o watcher, e voltar mostra o que mudou nesse meio tempo", async () => {
    const ctx = await setup();
    await openSession(ctx);
    await openChanges();
    await settle(() => screen.queryByText("Nada mudou.") !== null);
    expect(screen.queryByText("Nada mudou.")).not.toBeNull();
    // Leaving the tab stops the watcher: no frame is handled for a panel that is gone.
    await click("Conversa");
    expect(screen.queryByRole("region", { name: "Mudanças" })).toBeNull();
    writeFileSync(join(ctx.repo, "tarde.txt"), "um\n");
    await act(() => Bun.sleep(700));
    await openChanges();
    await settle(() => files().includes("tarde.txt"));
    expect(files()).toContain("tarde.txt");
  });
});
