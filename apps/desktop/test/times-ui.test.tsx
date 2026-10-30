import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";
import { runCli } from "../../daemon/src/main.ts";
import { FrameClient } from "../../daemon/test/history-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

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

/** A --runtime fake daemon with a project, and the app on its Times screen. */
async function open() {
  const dir = realTempDir("fd-times-ui-");
  const repo = join(dir, "app");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.test");
  git(repo, "config", "user.name", "t");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# app\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  const token = "times-ui-token-0123456789abcdef0123";
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      hostName: "pc",
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
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(() => store.addHost({ name: "alfa", url: daemon?.url ?? "", token }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  await settle(() => screen.queryByRole("button", { name: "Times" }) !== null, 3000);
  await click("Times");
  const teams = async () =>
    (
      await client.data<{
        teams: Array<{ id: string; name: string; state: string; members: unknown[] }>;
      }>("teams.list", {})
    )?.teams ?? [];
  return { store, client, project, teams };
}

const row = (name: string) => screen.queryByRole("listitem", { name: `Time ${name}` });

describe("times-ui: the teams of a host", () => {
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
});
