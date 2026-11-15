import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { installFakeCli } from "../../../../scripts/test/fake-cli.ts";
import { fakeAssistant, memoryPlatform, TOKEN } from "../fixtures.ts";
import { legacyDaemon } from "../legacy-daemon.ts";
import { settleMaybe } from "../wait.ts";
import {
  App,
  AppStore,
  act,
  change,
  cleanups,
  click,
  create,
  daemonWithProject,
  fireEvent,
  open,
  render,
  row,
  screen,
  settle,
  teardown,
  within,
} from "./times-ui-setup.tsx";

setDefaultTimeout(60_000);
afterEach(teardown);

describe("times-ui: the members of a team and the hosts without teams", () => {
  test("a member's persona is switched with a picker of the host's personas", async () => {
    await open();
    await create("t5", "1");
    await settle(
      () =>
        within(row("t5") as HTMLElement).queryByLabelText("Persona de t5 · executora 1")
          ?.tagName === "SELECT",
    );
  });

  test("a host with no project says so, adds one from the form, and Criar time waits for goal and project", async () => {
    const { teams, repo } = await open({ projects: false });
    await click("Novo time");
    await settle(() => screen.queryByText("Este host ainda não tem projetos.") !== null);
    const button = () =>
      screen.queryByRole("button", { name: "Criar e iniciar" }) as HTMLButtonElement | null;
    expect(button()?.disabled).toBe(true);
    await change("Objetivo", "com projeto novo");
    // The goal is there; the project is what is missing, and the reason says so.
    expect(button()?.disabled).toBe(true);
    expect(screen.queryByText("Escolha um projeto.")).not.toBeNull();
    const form = screen
      .getByText("Este host ainda não tem projetos.")
      .closest("div") as HTMLElement;
    await click("Adicionar projeto", form.parentElement);
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.change(within(dialog).getByLabelText("Pasta do projeto"), {
        target: { value: repo },
      });
    });
    await click("Adicionar", dialog);
    await settle(() => button()?.disabled === false);
    await change("Nome do time", "novo");
    await click("Criar e iniciar");
    await settle(() => row("novo") !== null);
    expect((await teams()).map((t) => t.name)).toEqual(["novo"]);
  });

  test("a refusal of the host says why, in the app's language", async () => {
    const { store } = await open();
    const hostId = store.getState().hosts[0]?.id ?? "";
    await act(async () => {
      await store.hostCommand(hostId, "teams.create", {
        projectId: "fantasma",
        goal: "x",
        workers: 1,
      });
    });
    await settle(() =>
      screen
        .queryAllByRole("alert")
        .map((a) => a.textContent ?? "")
        .join("|")
        .includes("O projeto fantasma não está neste host"),
    );
  });

  test("without a host with teams, the screen says so", async () => {
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    const daemon = legacyDaemon(cleanups);
    render(<App store={store} />);
    await act(() => store.roster.add({ name: "velho", url: daemon.url, token: TOKEN }));
    await settle(() => store.getState().hosts[0]?.hostInfo != null);
    await act(async () => {
      store.router.push({ name: "teams" });
    });
    expect(screen.queryByText("Nenhum host conectado com times")).not.toBeNull();
  });

  test("the empty state has a way out: Adicionar host opens the add-host form", async () => {
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    const daemon = legacyDaemon(cleanups);
    render(<App store={store} />);
    await act(() => store.roster.add({ name: "velho", url: daemon.url, token: TOKEN }));
    await settle(() => store.getState().hosts[0]?.hostInfo != null);
    await act(async () => {
      store.router.push({ name: "teams" });
    });
    await click("Adicionar host");
    expect(store.router.current.name).toBe("add-host");
  });

  test("each member's state and links sit in a fixed column on the right, and its persona row lines up (#594)", async () => {
    await open();
    await create("grade", "2");
    const item = row("grade") as HTMLElement;
    expect(item).not.toBeNull();
    const members = [...item.querySelectorAll<HTMLElement>("[data-slot='team-member']")];
    expect(members).toHaveLength(3);
    const classes = (el: Element | null | undefined) => el?.className.split(" ") ?? [];
    for (const member of members) {
      // One grid for every row: the name and chips, then a column of the same width on the right.
      expect(classes(member.querySelector("[data-slot='member-head']"))).toContain("member-head");
      expect(classes(member.querySelector("[data-slot='member-end']"))).toContain("member-end");
      // The persona row: a select of a fixed width and two outline buttons of the same height, on
      // the shared field row, lined up by their bottom edges (#101).
      expect(classes(member.querySelector("[data-slot='member-persona']"))).toContain(
        "field-row-end",
      );
      expect(classes(member.querySelector("[data-slot='persona-field']"))).toContain(
        "persona-field",
      );
    }
    const change = within(item).queryByRole("button", {
      name: "Trocar persona de grade · executora 1",
    });
    expect(change?.getAttribute("data-variant") ?? "").toBe("outline");
    const remove = within(item).queryByRole("button", { name: "Remover grade · executora 1" });
    expect(remove?.getAttribute("data-variant") ?? "").toBe("outline");
    // The footer sits on the cards' scale.
    expect(classes(item.querySelector("[data-slot='team-footer']"))).toContain("team-footer");
  });

  test("a member row links to its session and to its card", async () => {
    const { store, project } = await open();
    await create("links", "1");
    // The row is looked up again at each check: the list remounts when the route returns, and a
    // row read before that is null (or a detached one that never shows the button).
    const memberButton = (name: string) => {
      const item = row("links");
      return item ? within(item).queryByRole("button", { name }) : null;
    };
    await settle(() => memberButton("Abrir sessão de links · coordenadora") !== null);
    await click("Abrir sessão de links · coordenadora", row("links") as HTMLElement);
    expect(store.router.current).toMatchObject({ name: "session" });
    await act(async () => {
      store.router.push({ name: "teams" });
    });
    await settle(() => memberButton("Card de links · executora 1") !== null);
    await click("Card de links · executora 1", row("links") as HTMLElement);
    expect(store.router.current).toMatchObject({
      name: "card",
      projectId: project?.id,
    });
  });
});

describe("times-ui: the new team form keeps its action in reach (issue #769)", () => {
  test("Create and start sits in sticky actions, so a short window does not hide it", async () => {
    await open();
    await click("Novo time");
    await change("Objetivo", "objetivo de alcance");
    const create = screen.queryByRole("button", { name: "Criar e iniciar" });
    expect(
      create?.closest("[data-sticky-actions]") != null,
      "the button is in sticky actions",
    ).toBe(true);
  });
});

describe("times-ui: the wand on the goal of a new team (issue #160)", () => {
  const answer = {
    model: "claude-haiku-5-5",
    provider: "anthropic" as const,
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason: "end_turn" as const,
    notices: [] as string[],
  };
  const assistantWith = async (configured = true) => {
    const fake = fakeAssistant({
      run: () => ({ ...answer, text: "Rever o fluxo de login; pronto quando os testes passarem." }),
    });
    if (configured) await fake.assistant.setKey("anthropic", "sk-ant-aaaabbbb");
    return fake;
  };
  const configure = async (store: InstanceType<typeof AppStore>) => {
    store.assistant.setPrefs({ provider: "anthropic" });
    await store.assistant.refreshKeys();
  };

  test("the goal is improved, the preview is accepted into the field, and no team is made by it", async () => {
    const fake = await assistantWith();
    const { store, teams } = await open({ assistant: fake });
    await configure(store);
    await click("Novo time");
    expect(
      (screen.queryByRole("button", { name: "Escreva algo primeiro" }) as HTMLButtonElement | null)
        ?.disabled,
    ).toBe(true);
    await change("Objetivo", "revisar login");
    await click("Melhorar com IA");
    await settle(() => screen.queryByRole("dialog", { name: "Sugestão da IA" }) !== null);
    expect(JSON.stringify(fake.calls.filter((c) => c[0] === "run").at(-1)?.[1])).toContain(
      "coordinator who splits the work",
    );
    await click("Aceitar");
    expect((screen.queryByLabelText("Objetivo") as HTMLTextAreaElement).value).toBe(
      "Rever o fluxo de login; pronto quando os testes passarem.",
    );
    expect(await teams()).toEqual([]);
    expect(screen.queryByRole("button", { name: "Criar e iniciar" })).not.toBeNull();
  });

  test("with no provider the wand opens Settings, Assistant", async () => {
    const fake = await assistantWith(false);
    const { store } = await open({ assistant: fake });
    await click("Novo time");
    await change("Objetivo", "revisar login");
    await click("Melhorar com IA");
    expect(store.router.current).toEqual({ name: "settings", section: "assistant" });
    expect(fake.calls.filter((c) => c[0] === "run")).toHaveLength(0);
  });
});

// Issue #932: the Teams page's host follows the top bar's switcher, or says it shows another one.
describe("times-ui: the host follows the switcher", () => {
  const hostField = () => screen.queryByLabelText("Host") as HTMLSelectElement | null;
  // A switch opens that host's Overview, which asks its daemon whether GitHub is signed in: a fake
  // answers "not signed in", the real `gh` never runs.
  const fakeGh = () => {
    const gh = installFakeCli("gh", [
      { args: ["auth", "status"], stderr: "not logged in", code: 1 },
    ]);
    cleanups.push(() => gh.restore());
  };

  test("with two hosts with teams, Times opens on the switcher's host, after each switch", async () => {
    fakeGh();
    const { store } = await open();
    const other = await daemonWithProject("pi");
    await act(() => store.roster.add({ name: "beta", url: other.url, token: other.token }));
    await settle(() => store.getState().hosts.every((h) => h.hostInfo != null));
    const [alfa, beta] = store.getState().hosts.map((h) => h.id);
    // A pick in the switcher shows that host's tabs; Times then opens on that host.
    await act(async () => store.hostTabs.switchHost(beta as string));
    await click("Times");
    await settleMaybe(() => hostField()?.value === beta);
    const first = hostField()?.value;
    await act(async () => store.hostTabs.switchHost(alfa as string));
    await click("Times");
    await settleMaybe(() => hostField()?.value === alfa);
    expect({
      first: first === beta,
      after: hostField()?.value === alfa,
      notice: screen.queryByText(/não tem times|está offline\. Mostrando/) !== null,
    }).toEqual({ first: true, after: true, notice: false });
  });

  // Review of #964: an alert's host is the route's, and a later switch does not drop it.
  test("a route's host (an alert) wins over the switcher, with no notice", async () => {
    fakeGh();
    const { store } = await open();
    const other = await daemonWithProject("pi");
    await act(() => store.roster.add({ name: "beta", url: other.url, token: other.token }));
    await settle(() => store.getState().hosts.every((h) => h.hostInfo != null));
    const [alfa, beta] = store.getState().hosts.map((h) => h.id);
    await act(async () => store.hostTabs.switchHost(alfa as string));
    await act(async () => store.router.push({ name: "teams", host: beta as string }));
    await settleMaybe(() => hostField()?.value === beta);
    expect({
      shown: hostField()?.value === beta,
      notice: screen.queryByText(/não tem times|está offline\. Mostrando/) !== null,
    }).toEqual({ shown: true, notice: false });
  });

  test("a switcher host with no teams is named, with the host the page shows instead", async () => {
    fakeGh();
    const { store } = await open();
    const legacy = legacyDaemon(cleanups);
    await act(() => store.roster.add({ name: "gama", url: legacy.url, token: TOKEN }));
    await settle(() => store.getState().hosts.every((h) => h.hostInfo != null));
    const gama = store.getState().hosts.find((h) => h.name === "gama")?.id as string;
    await act(async () => store.hostTabs.switchHost(gama));
    await click("Times");
    const said = () => screen.queryByText("gama não tem times. Mostrando alfa.") !== null;
    await settleMaybe(said);
    expect(said()).toBe(true);
  });
});
