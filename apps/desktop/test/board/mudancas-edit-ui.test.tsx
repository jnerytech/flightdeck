import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  act,
  click,
  files,
  fireEvent,
  openChanges,
  openSession,
  runCleanups,
  screen,
  settle,
  setup,
} from "./mudancas-setup.tsx";

const { EditorView } = await import("@codemirror/view");

// Real git and a real watcher under the in-process daemon: more than the default 5 s.
setDefaultTimeout(30_000);

afterEach(runCleanups);

describe("mudancas-edit-ui", () => {
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
    // The editor is a modal dialog: the page behind it is aria-hidden, so the diff is looked up
    // as hidden. The save must have refreshed it.
    await settle(() =>
      (
        screen.queryByRole("region", { name: "Diff unificado", hidden: true })?.textContent ?? ""
      ).includes("+DOIS"),
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

    // Esc closes it too.
    await click("Editar arquivo novo.txt");
    await settle(() => screen.queryByRole("dialog", { name: "Editar novo.txt" }) !== null);
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("dialog", { name: "Editar novo.txt" }), {
        key: "Escape",
      });
    });
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

  test("um arquivo grande demais para mostrar vem com o tamanho e um jeito de abrir fora, sem o conteúdo", async () => {
    const ctx = await setup();
    const shown: string[] = [];
    ctx.platform.openPath = async () => {};
    ctx.platform.revealPath = async (path) => {
      shown.push(path);
    };
    writeFileSync(join(ctx.repo, "dump.log"), `SEGREDO${"x".repeat(700_000)}`);
    writeFileSync(join(ctx.repo, "novo.txt"), "um\ndois\n");
    await openSession(ctx);
    await openChanges();
    await settle(() => files().includes("dump.log"));
    expect(files()).toContain("Grande demais");
    const diff = () => screen.queryByRole("region", { name: "Diff unificado" })?.textContent ?? "";
    expect(diff()).toContain("Grande demais para mostrar aqui (683.6 KB)");
    expect(diff()).not.toContain("SEGREDO");
    // The small file beside it is shown whole.
    expect(diff()).toContain("+dois");
    // Any file can be shown in its folder; opening one with the system's app is refused for most extensions.
    await click("Mostrar dump.log na pasta");
    expect(shown).toHaveLength(1);
    expect(shown[0]?.endsWith("/dump.log")).toBe(true);
    // The editor stays one click away: it says why it cannot take the file when it is over 1 MB.
    expect(screen.queryByRole("button", { name: "Editar arquivo dump.log" })).not.toBeNull();
  });

  test("sem programa do sistema (o app no navegador) o motivo aparece e não há botão de abrir fora", async () => {
    const ctx = await setup();
    ctx.platform.openPath = undefined;
    writeFileSync(join(ctx.repo, "dump.log"), "x".repeat(700_000));
    await openSession(ctx);
    await openChanges();
    await settle(() => files().includes("dump.log"));
    const diff = screen.queryByRole("region", { name: "Diff unificado" })?.textContent ?? "";
    expect(diff).toContain("Grande demais para mostrar aqui");
    expect(screen.queryByRole("button", { name: "Mostrar dump.log na pasta" })).toBeNull();
  });
});
