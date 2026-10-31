import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SnapshotInfo } from "@flightdeck/protocol";
import { loadConfig } from "../../daemon/src/config.ts";
import { git } from "../../daemon/test/board-helpers.ts";
import { poll } from "../../daemon/test/helpers.ts";
import { userLine, writeTranscript } from "../../daemon/test/history-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { turnsOf } = await import("../src/lib/turns.ts");

// Real git and a real daemon: more than the default 5 s.
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

const click = async (name: string | RegExp, role = "button") => {
  const element = screen.queryByRole(role, { name });
  expect(element).not.toBeNull();
  await act(async () => {
    fireEvent.click(element as HTMLElement);
  });
};

const text = (path: string) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");

/**
 * A host with a managed session in a git repository. Besides the turn the fake runtime ran, the
 * snapshots hold three more, taken by hand: one that rewrites README and creates a file (with the
 * user message's uuid), one that changes nothing (with its uuid) and one without a uuid.
 */
async function setup(options: { checkpoints?: boolean; git?: boolean } = {}) {
  const d = makeDaemon(cleanups, { checkpoints: options.checkpoints ?? true });
  const repo = options.git === false ? d.project : join(d.root, "repo");
  if (options.git !== false) {
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "commit.gpgsign", "false");
    writeFileSync(join(repo, "README.md"), "# repo\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "inicial");
  }
  const { sessionId } = d.manager.create({ cwd: repo, prompt: "oi", name: "Alpha" });
  await poll(() => d.manager.get(sessionId).status === "idle");
  await d.snapshots?.idle();
  const claudeSessionId = d.manager.get(sessionId).claudeSessionId as string;
  const take = async (kind: "before" | "after", prompt?: string, turnUuid?: string) => {
    await d.snapshots?.take({
      cwd: repo,
      claudeSessionId,
      kind,
      ...(prompt ? { prompt } : {}),
      ...(turnUuid ? { turnUuid } : {}),
    });
  };
  if (options.git !== false && options.checkpoints !== false) {
    await take("before", "arrume o README", "u-readme");
    writeFileSync(join(repo, "README.md"), "v2\n");
    writeFileSync(join(repo, "novo.txt"), "x\n");
    await take("after");
    await take("before", "só conversa", "u-conversa");
    await take("after");
    await take("before", "sem uuid");
    await take("after");
  }
  const server = d.listen();
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id as string;
  await act(async () => {
    store.router.push({ name: "session", host: hostId, id: sessionId });
  });
  await settle(() => screen.queryByRole("button", { name: "Interromper" }) !== null);
  // The button needs the claudeSessionId, which comes with the replayed events after the subscribe.
  if (options.checkpoints !== false) {
    await settle(() => screen.queryByRole("button", { name: "Linha do tempo" }) !== null);
  }
  return { ...d, repo, store, hostId, sessionId, claudeSessionId };
}

/** The timeline's sheet, open. */
async function openTimeline() {
  await click("Linha do tempo");
  await settle(() => screen.queryByRole("dialog", { name: "Linha do tempo" }) !== null);
  await settle(() => sheet().queryByText("arrume o README") !== null);
}

/** The sheet's own text: the conversation behind it repeats the prompts. */
const sheet = () => within(screen.queryByRole("dialog", { name: "Linha do tempo" }) as HTMLElement);
const turn = (prompt: string) => sheet().queryByText(prompt)?.closest("li") as HTMLElement;

describe("linha-do-tempo-ui", () => {
  test("sem os checkpoints no daemon, a sessão não tem linha do tempo", async () => {
    await setup({ checkpoints: false });
    expect(screen.queryByRole("button", { name: "Interromper" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Linha do tempo" })).toBeNull();
  });

  test("cada turno mostra o prompt, a hora e se mudou arquivos; abrir mostra quais", async () => {
    await setup();
    await openTimeline();
    expect(within(turn("oi")).queryByText("Sem mudança nos arquivos")).not.toBeNull();
    expect(within(turn("oi")).queryByText("Turno 1")).not.toBeNull();
    expect(within(turn("arrume o README")).queryByText("Mudou arquivos")).not.toBeNull();
    expect(within(turn("arrume o README")).queryByText(/\d{2}:\d{2}/)).not.toBeNull();
    expect(within(turn("só conversa")).queryByText("Sem mudança nos arquivos")).not.toBeNull();

    await click("Ver arquivos do turno 2");
    await settle(() => screen.queryByText("novo.txt") !== null);
    const files = within(turn("arrume o README"));
    expect(files.queryByText("README.md")).not.toBeNull();
    expect(files.queryByText("alterado")).not.toBeNull();
    expect(files.queryByText("novo.txt")).not.toBeNull();
    expect(files.queryByText("criado")).not.toBeNull();
    expect(files.queryByText("+2 −1")).not.toBeNull();
    await click("Esconder arquivos do turno 2");
    expect(screen.queryByText("novo.txt")).toBeNull();
  });

  test("voltar arquivos mostra a prévia, só muda depois da confirmação e dá para desfazer", async () => {
    const { repo } = await setup();
    await openTimeline();
    await click("Voltar arquivos até aqui (turno 2)");
    await settle(
      () => screen.queryByRole("dialog", { name: "Voltar arquivos até o turno 2" }) !== null,
    );
    const dialog = within(
      screen.queryByRole("dialog", { name: "Voltar arquivos até o turno 2" }) as HTMLElement,
    );
    await settle(() => dialog.queryByText("README.md") !== null);
    expect(dialog.queryByText("README.md")).not.toBeNull();
    expect(dialog.queryByText("volta ao que era")).not.toBeNull();
    expect(dialog.queryByText("novo.txt")).not.toBeNull();
    expect(dialog.queryByText("será removido (criado depois)")).not.toBeNull();
    expect(dialog.queryByText(/Só os arquivos do repositório voltam/)).not.toBeNull();
    // Looking is not doing.
    expect(text(join(repo, "README.md"))).toBe("v2\n");
    await click("Cancelar");
    await settle(() => screen.queryByRole("dialog", { name: /^Voltar arquivos/ }) === null);
    expect(text(join(repo, "README.md"))).toBe("v2\n");

    await click("Voltar arquivos até aqui (turno 2)");
    // The button waits for the preview.
    await settle(
      () =>
        screen.queryByRole("button", { name: "Voltar arquivos" })?.hasAttribute("disabled") ===
        false,
    );
    await click("Voltar arquivos");
    await settle(() => !existsSync(join(repo, "novo.txt")));
    expect(text(join(repo, "README.md"))).toBe("# repo\n");
    expect(existsSync(join(repo, "novo.txt"))).toBe(false);
    await settle(() => screen.queryByText("Arquivos voltados ao turno 2.") !== null);
    expect(screen.queryByText("Arquivos voltados ao turno 2.")).not.toBeNull();

    await click("Desfazer volta");
    await settle(() => existsSync(join(repo, "novo.txt")));
    expect(text(join(repo, "README.md"))).toBe("v2\n");
    expect(text(join(repo, "novo.txt"))).toBe("x\n");
    await settle(() => screen.queryByText("Volta desfeita.") !== null);
    expect(screen.queryByText("Volta desfeita.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Desfazer volta" })).toBeNull();
  });

  test("com a sessão num turno, voltar arquivos fica desligado e diz o motivo", async () => {
    const { manager, sessionId } = await setup();
    manager.send(sessionId, "[tool] escreva");
    await poll(() => manager.get(sessionId).status === "awaiting_permission");
    await openTimeline();
    expect(
      screen
        .queryByRole("button", { name: "Voltar arquivos até aqui (turno 2)" })
        ?.hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.queryByText("A sessão está num turno: pare-a antes de voltar arquivos."),
    ).not.toBeNull();
  });

  test("bifurcar abre uma sessão do Flightdeck a partir do turno, sem mexer nos arquivos", async () => {
    const { repo, runtime, manager, claudeSessionId } = await setup();
    await openTimeline();
    await click("Bifurcar daqui (turno 2)");
    await settle(
      () => screen.queryByRole("dialog", { name: "Bifurcar a partir do turno 2" }) !== null,
    );
    const dialog = within(
      screen.queryByRole("dialog", { name: "Bifurcar a partir do turno 2" }) as HTMLElement,
    );
    expect((dialog.queryByLabelText("Abrir no Flightdeck") as HTMLInputElement).checked).toBe(true);
    expect((dialog.queryByLabelText("Abrir no terminal") as HTMLInputElement).checked).toBe(false);
    expect((dialog.queryByLabelText("Voltar os arquivos também") as HTMLInputElement).checked).toBe(
      false,
    );
    await click("Bifurcar");
    await settle(() => runtime.forks.length === 1);
    expect(runtime.forks[0]).toMatchObject({
      claudeSessionId,
      upToMessageId: "u-readme",
      dir: repo,
    });
    await settle(() => manager.list().length === 2);
    expect(manager.list()).toHaveLength(2);
    expect(text(join(repo, "README.md"))).toBe("v2\n");
  });

  test("bifurcar para o terminal, voltando os arquivos junto: mostra a prévia e o comando", async () => {
    const { repo, runtime } = await setup();
    await openTimeline();
    await click("Bifurcar daqui (turno 2)");
    await settle(
      () => screen.queryByRole("dialog", { name: "Bifurcar a partir do turno 2" }) !== null,
    );
    const dialog = () =>
      within(screen.queryByRole("dialog", { name: "Bifurcar a partir do turno 2" }) as HTMLElement);
    await act(async () => {
      fireEvent.click(dialog().queryByLabelText("Abrir no terminal") as HTMLElement);
    });
    await act(async () => {
      fireEvent.click(dialog().queryByLabelText("Voltar os arquivos também") as HTMLElement);
    });
    await settle(() => dialog().queryByText("novo.txt") !== null);
    expect(dialog().queryByText("será removido (criado depois)")).not.toBeNull();
    // The files go back only when the fork is confirmed.
    expect(existsSync(join(repo, "novo.txt"))).toBe(true);
    await click("Bifurcar");
    await settle(() => dialog().queryByText(/--resume fake-fork-/) !== null);
    expect(dialog().queryByText(/--resume fake-fork-/)).not.toBeNull();
    expect(runtime.forks).toHaveLength(1);
    expect(existsSync(join(repo, "novo.txt"))).toBe(false);
    expect(text(join(repo, "README.md"))).toBe("# repo\n");
  });

  test("um turno sem a mensagem achada no transcript não bifurca, e diz por quê", async () => {
    await setup();
    await openTimeline();
    expect(
      screen.queryByRole("button", { name: "Bifurcar daqui (turno 4)" })?.hasAttribute("disabled"),
    ).toBe(true);
    expect(within(turn("sem uuid")).queryByText(/Não achei a mensagem deste turno/)).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Bifurcar daqui (turno 3)" })?.hasAttribute("disabled"),
    ).toBe(false);
  });

  test("fora de um repositório não há turnos, e a linha do tempo diz isso", async () => {
    await setup({ git: false });
    await click("Linha do tempo");
    await settle(() => screen.queryByText(/Ainda não há turnos/) !== null);
    expect(screen.queryByText(/Ainda não há turnos/)).not.toBeNull();
  });

  test("fechar a prévia e o formulário de bifurcar não faz nada, e Fechar esconde a linha do tempo", async () => {
    const { repo, runtime } = await setup();
    await openTimeline();
    // The dialog's own × (Esc would also reach the sheet under happy-dom), named from the dictionary.
    const dismiss = async (name: string) => {
      const dialog = within(screen.queryByRole("dialog", { name }) as HTMLElement);
      await act(async () => {
        fireEvent.click(dialog.queryByRole("button", { name: "Fechar" }) as HTMLElement);
      });
      await settle(() => screen.queryByRole("dialog", { name }) === null);
      expect(screen.queryByRole("dialog", { name })).toBeNull();
    };
    await click("Voltar arquivos até aqui (turno 2)");
    await settle(
      () => screen.queryByRole("dialog", { name: "Voltar arquivos até o turno 2" }) !== null,
    );
    await dismiss("Voltar arquivos até o turno 2");
    await settle(() => screen.queryByRole("button", { name: "Bifurcar daqui (turno 2)" }) !== null);
    await click("Bifurcar daqui (turno 2)");
    await settle(
      () => screen.queryByRole("dialog", { name: "Bifurcar a partir do turno 2" }) !== null,
    );
    await dismiss("Bifurcar a partir do turno 2");
    expect(text(join(repo, "README.md"))).toBe("v2\n");
    expect(runtime.forks).toHaveLength(0);

    await settle(() => screen.queryByRole("button", { name: "Fechar" }) !== null);
    await click("Fechar");
    await settle(() => screen.queryByRole("dialog", { name: "Linha do tempo" }) === null);
    expect(screen.queryByRole("dialog", { name: "Linha do tempo" })).toBeNull();
  });

  test("os turnos: sem fim registrado, o último está em andamento e os outros sem registro; os de segurança não contam", () => {
    const row = (n: number, kind: string, tree: string): SnapshotInfo => ({
      claudeSessionId: "s",
      n,
      ref: "r",
      tree,
      kind,
      turnUuid: null,
      prompt: `p${n}`,
      createdAt: "2026-11-03T10:00:00.000Z",
      repo: "/r",
    });
    const turns = turnsOf([
      row(1, "before", "a"),
      row(2, "after", "a"),
      row(3, "before", "a"),
      row(4, "before", "b"),
      row(5, "safety", "c"),
      row(6, "after", "d"),
      row(7, "before", "d"),
    ]);
    expect(turns.map((t) => [t.n, t.ordinal, t.files])).toEqual([
      [1, 1, "unchanged"],
      [3, 2, "unknown"],
      [4, 3, "changed"],
      [7, 4, "running"],
    ]);
  });

  test("uma sessão do terminal tem a linha do tempo, e bifurca porque o uuid foi achado no transcript", async () => {
    const d = makeDaemon(cleanups, { checkpoints: true });
    const repo = join(d.root, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "commit.gpgsign", "false");
    writeFileSync(join(repo, "README.md"), "# repo\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "inicial");
    d.central.hooksInstall(true);
    const hook = (event: string, body: object) =>
      fetch(`${d.central.receptorUrl()}/hooks/${event}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${loadConfig(d.configFile).hooks.token}` },
        body: JSON.stringify({ session_id: "ext-1", hook_event_name: event, cwd: repo, ...body }),
      });
    await hook("SessionStart", {});
    await hook("UserPromptSubmit", { prompt: "arrume o README" });
    await d.snapshots?.idle();
    writeFileSync(join(repo, "README.md"), "# arrumado\n");
    await hook("Stop", {});
    await d.snapshots?.idle();
    writeTranscript(d.historyRoot, "-p", "ext-1", [
      userLine({ uuid: "u-ext", text: "arrume o README", cwd: repo }),
    ]);
    d.history.scan();
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => Object.keys(store.getState().externals).length === 1);
    const hostId = store.getState().hosts[0]?.id as string;
    await act(async () =>
      store.router.push({ name: "external", host: hostId, claudeSessionId: "ext-1" }),
    );
    await settle(() => screen.queryByRole("button", { name: "Linha do tempo" }) !== null);
    await click("Linha do tempo");
    await settle(() => sheet().queryByText("arrume o README") !== null);
    expect(within(turn("arrume o README")).queryByText("Mudou arquivos")).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Bifurcar daqui (turno 1)" })?.hasAttribute("disabled"),
    ).toBe(false);
  });
});
