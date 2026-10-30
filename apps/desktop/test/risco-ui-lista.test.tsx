import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../daemon/test/board-helpers.ts";
import { trayStatus } from "../src/lib/tray.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { workflowDaemon } from "./workflow-fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

// Real git under the in-process daemon: more than 5 s.
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

const click = async (name: string | RegExp, scope: HTMLElement | null = null) => {
  const button = (scope ? within(scope) : screen).queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
const change = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label) as HTMLInputElement | HTMLSelectElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLInputElement, { target: { value } });
  });
};

const rows = () =>
  [...(screen.queryByRole("list", { name: "Decisões automáticas" })?.children ?? [])].map(
    (li) => li.textContent ?? "",
  );

const low = { level: "low", reason: "leitura dentro do projeto", network: false } as const;
const high = { level: "high", reason: "apaga arquivos", network: false } as const;

/** A host with a project that has the automatic approval on, two decisions already taken. */
async function setup(features?: string[]) {
  const d = await workflowDaemon(cleanups, {}, [], { autoApprove: true });
  const approver = d.autoApprove;
  if (!approver) throw new Error("o daemon de teste não tem a aprovação automática");
  d.board.updateProject(d.project.id, { autoApprove: { enabled: true } });
  const decide = (
    cwd: string,
    requestId: string,
    toolName: string,
    risk: typeof low | typeof high,
  ) => approver.decide({ sessionKey: "s1", requestId, toolName, input: {}, cwd, risk });
  await decide(d.repo, "r1", "Read", low);
  await Bun.sleep(5);
  await decide(d.repo, "r2", "Bash", high);
  const server = features ? d.listen(0, undefined, features) : d.server;
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  await act(async () => {
    store.router.push({ name: "host", host: store.getState().hosts[0]?.id as string });
  });
  return { ...d, approver, decide, store };
}

describe("risco-ui: a lista de aprovações automáticas", () => {
  test("um daemon que não anuncia autoapprove não tem o botão", async () => {
    await setup(["workflows", "rules"]);
    expect(screen.queryByRole("button", { name: "Aprovações automáticas" })).toBeNull();
  });

  test("a lista mostra a mais nova primeiro, com a ferramenta, o risco, a decisão, quem decidiu e o motivo", async () => {
    await setup();
    await click("Aprovações automáticas");
    await settle(() => rows().length === 2);
    const [newest, oldest] = rows();
    for (const part of [
      "Bash",
      "Risco alto",
      "Perguntou a você",
      "Regra",
      "risco alto nunca é automático",
    ]) {
      expect(newest ?? "").toContain(part);
    }
    for (const part of ["Read", "Risco baixo", "Aprovou", "Regra", "risco baixo, sem IA"]) {
      expect(oldest ?? "").toContain(part);
    }
  });

  test("uma decisão da IA mostra o modelo que decidiu", async () => {
    const d = await setup();
    d.runtime.judgePermission = async () => ({ decision: "allow", reason: "só lê um arquivo" });
    await d.decide(d.repo, "r3", "Grep", { level: "medium", reason: "busca", network: false });
    await click("Aprovações automáticas");
    await settle(() => rows().length === 3);
    expect(rows()[0]).toContain("IA (");
  });

  test("Filtrar decisões reduz a lista pela ferramenta ou pelo motivo", async () => {
    await setup();
    await click("Aprovações automáticas");
    await settle(() => rows().length === 2);
    await change("Filtrar decisões", "bash");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain("Bash");
    await change("Filtrar decisões", "sem IA");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain("Read");
    await change("Filtrar decisões", "nada disso");
    expect(rows()).toHaveLength(0);
    expect(screen.queryByText("Nenhuma decisão corresponde ao filtro")).not.toBeNull();
  });

  test("o filtro de projeto pede ao daemon só as decisões daquele projeto", async () => {
    const { board, decide, root } = await setup();
    const other = join(root, "outro");
    mkdirSync(other);
    git(other, "init", "-q", "-b", "main");
    git(other, "config", "commit.gpgsign", "false");
    writeFileSync(join(other, "README.md"), "# outro\n");
    git(other, "add", ".");
    git(other, "commit", "-q", "-m", "inicial");
    const project = await board.addProject({ path: other, promptTemplate: "" });
    board.updateProject(project.id, { autoApprove: { enabled: true } });
    await decide(other, "r3", "Glob", low);
    await click("Aprovações automáticas");
    await settle(() => rows().length === 3);
    expect(screen.queryByLabelText("Projeto")).not.toBeNull();
    await change("Projeto", project.id);
    await settle(() => rows().length === 1);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain("Glob");
    await change("Projeto", "");
    await settle(() => rows().length === 3);
    expect(rows()).toHaveLength(3);
  });

  test("sem decisões, a tela diz que ainda não há nenhuma", async () => {
    const d = await workflowDaemon(cleanups, {}, [], { autoApprove: true });
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.server.url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.hostInfo != null);
    await act(async () => {
      store.router.push({ name: "host", host: store.getState().hosts[0]?.id as string });
    });
    await click("Aprovações automáticas");
    await settle(() => screen.queryByText("Nenhuma decisão automática ainda") !== null);
    expect(screen.queryByText("Nenhuma decisão automática ainda")).not.toBeNull();
    expect(screen.queryByText("Nenhuma sessão suspensa")).not.toBeNull();
  });

  test("uma sessão suspensa aparece com o motivo, e Reativar pede confirmação", async () => {
    const { approver } = await setup();
    approver.suspend("card:abc", "conteúdo de terceiro chegou à sessão");
    await click("Aprovações automáticas");
    await settle(() => screen.queryByRole("button", { name: "Reativar card:abc" }) !== null);
    expect(screen.queryByText("conteúdo de terceiro chegou à sessão")).not.toBeNull();
    await click("Reativar card:abc");
    expect(screen.queryByRole("alertdialog")).not.toBeNull();
    await click("Cancelar");
    expect(approver.suspended()).toHaveLength(1);
    await click("Reativar card:abc");
    await click("Reativar", screen.queryByRole("alertdialog"));
    await settle(() => screen.queryByRole("button", { name: "Reativar card:abc" }) === null);
    expect(screen.queryByRole("button", { name: "Reativar card:abc" })).toBeNull();
    expect(approver.suspended()).toHaveLength(0);
  });
});

describe("risco-ui: o contador da bandeja", () => {
  const hosts = [{ name: "alfa", sessions: [{ pendingPermissions: [] }] }];

  test("sem nada esperando, o texto da bandeja ainda diz quantas aprovações automáticas houve", () => {
    expect(trayStatus(hosts, undefined, 3).tooltip).toBe(
      "Flightdeck: nada esperando você · 3 aprovações automáticas",
    );
    expect(trayStatus(hosts, undefined, 1).tooltip).toBe(
      "Flightdeck: nada esperando você · 1 aprovação automática",
    );
    expect(trayStatus(hosts, undefined, 0).tooltip).toBe("Flightdeck: nada esperando você");
  });

  test("com pedidos esperando, o contador vem depois dos hosts", () => {
    const waiting = [{ name: "alfa", sessions: [{ pendingPermissions: [{}, {}] as never }] }];
    expect(trayStatus(waiting, undefined, 2).tooltip).toBe(
      "Flightdeck: 2 pedidos esperando você (alfa: 2) · 2 aprovações automáticas",
    );
  });
});
