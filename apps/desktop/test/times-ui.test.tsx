import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";
import { runCli } from "../../daemon/src/main.ts";
import { FrameClient } from "../../daemon/test/history-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(60_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(25));
}
const click = async (name: string | RegExp, scope: HTMLElement | null = null) => {
  const button = (scope ? within(scope) : screen).queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
const change = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label) as HTMLInputElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLInputElement, { target: { value } });
  });
};
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });

/** A --runtime fake daemon named `hostName` with a project. */
async function daemonWithProject(hostName: string) {
  const dir = realTempDir(`fd-times-ui-${hostName}-`);
  const repo = join(dir, "app");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.test");
  git(repo, "config", "user.name", "t");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# app\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  const token = `times-ui-${hostName}-token-0123456789abcdef`;
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      hostName,
      port: 0,
      token,
      dataDir: join(dir, "data"),
      hooks: { port: 0 },
      allowedRoots: [dir],
    }),
  );
  const daemon = await runCli(["--config", file, "--runtime", "fake"], {
    env: {},
    log: { log: () => {}, error: () => {} },
    exit: () => {},
    onSignal: () => {},
  });
  cleanups.push(() => daemon?.stop());
  const client = new FrameClient(daemon?.url ?? "");
  cleanups.push(() => client.close());
  await client.request("hello", { token, client: "t" });
  const project = await client.data<{ id: string }>("project.add", { path: repo });
  // A second project, for the form's project choice.
  const lib = join(dir, "lib");
  mkdirSync(lib);
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["config", "user.email", "t@example.test"],
    ["config", "user.name", "t"],
    ["config", "commit.gpgsign", "false"],
  ]) {
    git(lib, ...args);
  }
  writeFileSync(join(lib, "README.md"), "# lib\n");
  git(lib, "add", ".");
  git(lib, "commit", "-q", "-m", "inicial");
  const second = await client.data<{ id: string }>("project.add", { path: lib });
  type Listed = {
    teams: Array<{
      id: string;
      name: string;
      state: string;
      members: Array<{
        name: string;
        cardId: string | null;
        sessionId: string | null;
        persona: string | null;
      }>;
    }>;
  };
  const teams = async () => (await client.data<Listed>("teams.list", {}))?.teams ?? [];
  // Before the daemon stops: every worker's card has finished starting (or the start would
  // write to a closed database after the test).
  cleanups.push(async () => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const all = await teams();
      if (all.every((t) => t.members.every((m) => !m.cardId || m.sessionId))) return;
      await Bun.sleep(50);
    }
  });
  return { url: daemon?.url ?? "", token, client, project, second, teams };
}

/** The app on a daemon with a project, on its Times screen. */
async function open() {
  const d = await daemonWithProject("pc");
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(() => store.addHost({ name: "alfa", url: d.url, token: d.token }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  await settle(() => screen.queryByRole("button", { name: "Times" }) !== null, 3000);
  await click("Times");
  return { store, ...d };
}

/** Creates a team through the form. */
async function create(name: string, workers = "1") {
  await click("Novo time");
  await change("Objetivo", `objetivo de ${name}`);
  await change("Nome do time", name);
  await change("Executoras", workers);
  await click("Criar time");
  await settle(() => row(name) !== null);
}

const row = (name: string) => screen.queryByRole("listitem", { name: `Time ${name}` });

describe("times-ui: the teams of a host", () => {
  test("the empty list offers its own button to create the first team", async () => {
    await open();
    await settle(() => screen.queryByText("Nenhum time ainda") !== null);
    await click("Criar o primeiro time");
    await settle(() => screen.queryByLabelText("Objetivo") !== null);
    expect(screen.queryByLabelText("Objetivo")).not.toBeNull();
  });

  test("Novo time creates a team with its goal, project and workers; it is listed with its coordinator and workers", async () => {
    const { teams } = await open();
    await click("Novo time");
    await change("Objetivo", "revisar o login");
    await change("Nome do time", "login");
    await change("Executoras", "2");
    await click("Criar time");
    await settle(() => row("login") !== null);
    const created = await teams();
    expect(created.map((t) => [t.name, t.members.length])).toEqual([["login", 3]]);
    const item = row("login") as HTMLElement;
    expect(item.textContent).toContain("revisar o login");
    expect(item.textContent).toContain("Ativo");
    expect(item.textContent).toContain("login · coordenadora");
    expect(item.textContent).toContain("login · executora 2");
    // A member's session state comes from the dictionary, never as the protocol's word.
    const state = /(running|waiting|idle|ended|Rodando|Esperando você|Ociosa|Encerrada)/;
    await settle(() => state.test(row("login")?.textContent ?? ""));
    expect(row("login")?.textContent).toMatch(state);
    expect(row("login")?.textContent).not.toMatch(/(running|waiting|idle|ended)/);
  });

  test("Novo time takes the workers' personas, one per worker in order", async () => {
    const { teams } = await open();
    await click("Novo time");
    await change("Objetivo", "com personas");
    await change("Nome do time", "tp");
    await change("Executoras", "2");
    await change("Personas das executoras (opcional, separadas por vírgula)", "qa, revisor");
    await click("Criar time");
    await settle(() => row("tp") !== null);
    const members = (await teams())[0]?.members as Array<{ name: string; persona: string | null }>;
    expect(members.filter((m) => m.name.includes("executora")).map((m) => m.persona)).toEqual([
      "qa",
      "revisor",
    ]);
  });

  test("Pausar and Retomar change the team's state; Mandar a todos sends to every member", async () => {
    const { teams, client } = await open();
    await click("Novo time");
    await change("Objetivo", "um objetivo");
    await change("Nome do time", "t1");
    await click("Criar time");
    await settle(() => row("t1") !== null);
    await click("Pausar t1", row("t1"));
    await settle(() => row("t1")?.textContent?.includes("Pausado") === true);
    expect((await teams())[0]?.state).toBe("paused");
    await click("Retomar t1", row("t1"));
    await settle(() => row("t1")?.textContent?.includes("Ativo") === true);
    await act(async () => {
      fireEvent.change(within(row("t1") as HTMLElement).getByLabelText("Mensagem para todos"), {
        target: { value: "status, por favor" },
      });
    });
    await click("Mandar a todos", row("t1"));
    await settle(() => within(row("t1") as HTMLElement).queryByRole("status") !== null);
    expect(within(row("t1") as HTMLElement).queryByRole("status")?.textContent).toMatch(
      /\d+ entregues/,
    );
    const sent = await client.data<{ messages: Array<{ text: string; kind: string }> }>(
      "messages.list",
      {},
    );
    expect(sent?.messages.some((m) => m.text.includes("status, por favor"))).toBe(true);
  });

  test("Encerrar asks first: cancelling keeps the team, confirming closes it", async () => {
    const { teams } = await open();
    await click("Novo time");
    await change("Objetivo", "outro");
    await change("Nome do time", "t2");
    await click("Criar time");
    await settle(() => row("t2") !== null);
    await click("Encerrar t2", row("t2"));
    await click("Cancelar", screen.queryByRole("alertdialog"));
    expect((await teams())[0]?.state).toBe("active");
    await click("Encerrar t2", row("t2"));
    await click("Encerrar", screen.queryByRole("alertdialog"));
    await settle(() => row("t2")?.textContent?.includes("Encerrado") === true);
    expect((await teams())[0]?.state).toBe("closed");
  });

  test("a worker is added, and a member's persona changes", async () => {
    const { teams } = await open();
    await click("Novo time");
    await change("Objetivo", "mais um");
    await change("Nome do time", "t3");
    await change("Executoras", "1");
    await click("Criar time");
    await settle(() => row("t3") !== null);
    await click("Adicionar executora a t3", row("t3"));
    await settle(() => (row("t3")?.textContent ?? "").includes("t3 · executora 2"));
    expect((await teams())[0]?.members.length).toBe(3);
    await act(async () => {
      fireEvent.change(
        within(row("t3") as HTMLElement).getByLabelText("Persona de t3 · executora 1"),
        {
          target: { value: "qa" },
        },
      );
    });
    await click("Trocar a persona de t3 · executora 1", row("t3"));
    await settle(() => (row("t3")?.textContent ?? "").includes("qa"));
    const members = (await teams())[0]?.members as Array<{ name: string; persona: string | null }>;
    expect(members.find((m) => m.name === "t3 · executora 1")?.persona).toBe("qa");
  });

  test("a worker is removed after a confirmation, and a member's report shows", async () => {
    const { client, teams } = await open();
    await create("t4", "2");
    const listed = await teams();
    const team = listed[0];
    const worker = team?.members.find((m) => m.name === "t4 · executora 1");
    await (async () => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && !(await teams())[0]?.members.every((m) => m.sessionId)) {
        await Bun.sleep(50);
      }
    })();
    const members = (await teams())[0]?.members ?? [];
    const from = members.find((m) => m.name === "t4 · executora 1")?.sessionId ?? worker?.sessionId;
    const to = members.find((m) => m.name === "t4 · coordenadora")?.sessionId;
    await client.data("messages.send", { as: { session: from }, to, text: "terminei a tarefa" });
    // The screen reads the status again on a team change: adding nothing, it reloads on resume.
    await click("Pausar t4", row("t4"));
    await settle(
      () => within(row("t4") as HTMLElement).queryByRole("button", { name: "Retomar t4" }) !== null,
    );
    await click("Retomar t4", row("t4"));
    await settle(() => (row("t4")?.textContent ?? "").includes("terminei a tarefa"));
    expect(row("t4")?.textContent).toContain("terminei a tarefa");
    await click("Remover t4 · executora 2", row("t4"));
    await click("Remover", screen.queryByRole("alertdialog"));
    await settle(() => !(row("t4")?.textContent ?? "").includes("t4 · executora 2"));
    expect((await teams())[0]?.members.map((m) => m.name)).not.toContain("t4 · executora 2");
  });

  test("Cancelar closes the form; with two hosts with teams, a picker chooses the host", async () => {
    const { store } = await open();
    await click("Novo time");
    await click("Cancelar");
    expect(screen.queryByLabelText("Objetivo")).toBeNull();
    const other = await daemonWithProject("pi");
    await act(() => store.addHost({ name: "beta", url: other.url, token: other.token }));
    await settle(() => store.getState().hosts.every((h) => h.hostInfo != null));
    await settle(() => screen.queryByLabelText("Host") !== null);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Host"), {
        target: { value: store.getState().hosts[1]?.id },
      });
    });
    await click("Novo time");
    await change("Objetivo", "no outro projeto");
    await change("Nome do time", "no-pi");
    await change("Projeto", other.second?.id ?? "");
    await change("Persona da coordenadora (opcional)", "revisor");
    await click("Criar time");
    await settle(() => row("no-pi") !== null);
    const made = await other.teams();
    expect(made.map((t) => t.name)).toEqual(["no-pi"]);
    expect(made[0]?.members[0]?.persona).toBe("revisor");
  });

  test("without a host with teams, the screen says so", async () => {
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    const daemon = legacyDaemon(cleanups);
    render(<App store={store} />);
    await act(() => store.addHost({ name: "velho", url: daemon.url, token: TOKEN }));
    await settle(() => store.getState().hosts[0]?.hostInfo != null);
    await act(async () => {
      store.router.push({ name: "teams" });
    });
    expect(screen.queryByText("Nenhum host conectado com times")).not.toBeNull();
  });
});
