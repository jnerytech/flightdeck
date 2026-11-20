import { expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installFakeCli } from "../../../../scripts/test/fake-cli.ts";
import { realTempDir } from "../../../../scripts/test/temp-dir.ts";
import { runCli } from "../../../daemon/src/main.ts";
import { FrameClient } from "../../../daemon/test/support/history-helpers.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { type fakeAssistant, memoryPlatform } from "../fixtures.ts";
import { waiter } from "../wait.ts";

registerDom();
const testingLibrary = await import("@testing-library/react");
const { cleanup } = testingLibrary;
export const { act, fireEvent, render, within } = testingLibrary;
export const screen = liveScreen(within);
export const { AppStore } = await import("../../src/lib/app-store.ts");
export const { App } = await import("../../src/app/App.tsx");

export const cleanups: Array<() => unknown> = [];
/** The afterEach of every times-ui file: the DOM first, then what the test started, last first. */
export async function teardown() {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

export const settle = waiter(15_000);
export const click = async (name: string | RegExp, scope: HTMLElement | null = null) => {
  const button = (scope ? within(scope) : screen).queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
export const change = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label) as HTMLInputElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLInputElement, { target: { value } });
  });
};
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });

/** A --runtime fake daemon named `hostName` with a project. */
export async function daemonWithProject(
  hostName: string,
  options: { projects?: boolean; bypass?: boolean } = {},
) {
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
      allowBypassPermissions: options.bypass === true,
    }),
  );
  // The app asks this daemon for its background sessions (`claude agents`): a fake answers, the
  // real `claude` on PATH never runs.
  const claude = installFakeCli("claude", [{ args: ["agents"], stdout: "[]" }]);
  cleanups.push(() => claude.restore());
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
  const withProjects = options.projects !== false;
  const project = withProjects
    ? await client.data<{ id: string }>("project.add", { path: repo })
    : null;
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
  const second = withProjects
    ? await client.data<{ id: string }>("project.add", { path: lib })
    : null;
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
        model: string | null;
        permission?: string | null;
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
  return { url: daemon?.url ?? "", token, client, project, second, teams, repo };
}

/** The app on a daemon with a project, on its Times screen. */
export async function open(
  options: {
    projects?: boolean;
    bypass?: boolean;
    assistant?: ReturnType<typeof fakeAssistant>;
  } = {},
) {
  const d = await daemonWithProject("pc", options);
  const mem = memoryPlatform();
  if (options.assistant) mem.platform.assistant = options.assistant.assistant;
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  // The teams are the subject: the dependency check the app starts on connect would run the real programs' versions.
  store.health.check = async () => {};
  render(<App store={store} />);
  await act(() => store.roster.add({ name: "alfa", url: d.url, token: d.token }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  await settle(() => screen.queryByRole("button", { name: "Times" }) !== null, 3000);
  await click("Times");
  return { store, ...d };
}

/** Creates a team through the form. */
export async function create(name: string, workers = "1") {
  await click("Novo time");
  await change("Objetivo", `objetivo de ${name}`);
  await change("Nome do time", name);
  await workerRows(Number(workers));
  await click("Criar e iniciar");
  await settle(() => row(name) !== null);
}

/** Brings the form's worker rows (two to begin with) to `count`. */
export async function workerRows(count: number) {
  const rows = () => screen.queryAllByLabelText(/^Modelo da executora \d+$/).length;
  while (rows() < count) await click("Adicionar executora ao novo time");
  while (rows() > count) await click(`Remover a executora ${rows()}`);
  expect(rows()).toBe(count);
}

/** Picks the workers' personas in the form, one row each, by the persona's id. */
export async function pickWorkerPersonas(...ids: string[]) {
  await workerRows(ids.length);
  for (const [i, id] of ids.entries()) {
    await change(`Persona da executora ${i + 1} (opcional)`, id);
  }
}

export const row = (name: string) => screen.queryByRole("listitem", { name: `Time ${name}` });
