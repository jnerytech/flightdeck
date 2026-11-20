import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  act,
  change,
  click,
  create,
  daemonWithProject,
  fireEvent,
  open,
  pickWorkerPersonas,
  row,
  screen,
  settle,
  teardown,
  within,
  workerRows,
} from "./times-ui-setup.tsx";

setDefaultTimeout(60_000);
afterEach(teardown);

describe("times-ui: the teams of a host", () => {
  test("the empty list offers its own button to create the first team", async () => {
    await open();
    await settle(() => screen.queryByText("Nenhum time ainda") !== null);
    await click("Criar o primeiro time");
    await settle(() => screen.queryByLabelText("Objetivo") !== null);
    expect(screen.queryByLabelText("Objetivo")).not.toBeNull();
  });

  test("Criar time is disabled without a goal, and says why", async () => {
    await open();
    await click("Novo time");
    const button = screen.queryByRole("button", {
      name: "Criar e iniciar",
    }) as HTMLButtonElement | null;
    expect(button?.disabled).toBe(true);
    const reason = screen.queryByText("Escreva o objetivo do time.");
    expect(reason).not.toBeNull();
    expect(button?.getAttribute("aria-describedby")).toBe(reason?.id ?? "?");
  });

  test("Novo time creates a team with its goal, project and workers; it is listed with its coordinator and workers", async () => {
    const { teams } = await open();
    await click("Novo time");
    await change("Objetivo", "revisar o login");
    await change("Nome do time", "login");
    await workerRows(2);
    await click("Criar e iniciar");
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
    await pickWorkerPersonas("qa", "reviewer");
    await click("Criar e iniciar");
    await settle(() => row("tp") !== null);
    const members = (await teams())[0]?.members as Array<{ name: string; persona: string | null }>;
    expect(members.filter((m) => m.name.includes("executora")).map((m) => m.persona)).toEqual([
      "qa",
      "reviewer",
    ]);
  });

  test("Novo time makes the Developer the workers' default persona, in every row, added ones too", async () => {
    const { teams } = await open();
    await click("Novo time");
    await change("Objetivo", "codar");
    await change("Nome do time", "dev");
    await workerRows(2);
    await settle(
      () =>
        (screen.queryByLabelText("Persona da executora 2 (opcional)") as HTMLSelectElement | null)
          ?.value === "dev",
    );
    expect(
      (screen.queryByLabelText("Persona da executora 1 (opcional)") as HTMLSelectElement).value,
    ).toBe("dev");
    // The coordinator is not a worker: it keeps the default.
    expect(
      (screen.queryByLabelText("Persona da coordenadora (opcional)") as HTMLSelectElement).value,
    ).toBe("");
    await click("Criar e iniciar");
    await settle(() => row("dev") !== null);
    const members = (await teams())[0]?.members as Array<{ name: string; persona: string | null }>;
    expect(members.filter((m) => m.name.includes("executora")).map((m) => m.persona)).toEqual([
      "dev",
      "dev",
    ]);
  });

  test("Pausar and Retomar change the team's state; Mandar a todos sends to every member", async () => {
    const { teams, client } = await open();
    await click("Novo time");
    await change("Objetivo", "um objetivo");
    await change("Nome do time", "t1");
    await click("Criar e iniciar");
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
    await settle(() =>
      /\d+ entregues/.test(
        within(row("t1") as HTMLElement).queryByRole("status")?.textContent ?? "",
      ),
    );
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
    await click("Criar e iniciar");
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
    await workerRows(1);
    await click("Criar e iniciar");
    await settle(() => row("t3") !== null);
    // The button opens the pickers; Cancelar closes them without adding anything.
    await click("Adicionar executora a t3", row("t3"));
    await settle(
      () =>
        within(row("t3") as HTMLElement).queryByLabelText("Modelo da nova executora de t3") !==
        null,
    );
    await click("Cancelar", row("t3"));
    expect(
      within(row("t3") as HTMLElement).queryByLabelText("Modelo da nova executora de t3"),
    ).toBeNull();
    expect((await teams())[0]?.members.length).toBe(2);
    await click("Adicionar executora a t3", row("t3"));
    const form = row("t3") as HTMLElement;
    await settle(
      () =>
        (within(form)
          .queryByLabelText("Persona da nova executora de t3 (opcional)")
          ?.querySelectorAll("option").length ?? 0) > 5,
    );
    await act(async () => {
      fireEvent.change(within(form).getByLabelText("Persona da nova executora de t3 (opcional)"), {
        target: { value: "qa" },
      });
      fireEvent.change(within(form).getByLabelText("Modelo da nova executora de t3"), {
        target: { value: "sonnet" },
      });
    });
    await click("Adicionar a t3", row("t3"));
    await settle(() => (row("t3")?.textContent ?? "").includes("t3 · executora 2"));
    const added = (await teams())[0]?.members.find((m) => m.name === "t3 · executora 2");
    expect(added).toMatchObject({ persona: "qa", model: "sonnet" });
    expect((await teams())[0]?.members.length).toBe(3);
    await act(async () => {
      fireEvent.change(
        within(row("t3") as HTMLElement).getByLabelText("Persona de t3 · executora 1"),
        {
          target: { value: "qa" },
        },
      );
    });
    await click("Trocar persona de t3 · executora 1", row("t3"));
    // The persona shows by its name, not its id (#101).
    await settle(() => (row("t3")?.textContent ?? "").includes("QA / testes"));
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
    // The confirmation line names the worker (#2650): the worker's own controls are what goes.
    await settle(
      () =>
        within(row("t4") as HTMLElement).queryByRole("button", {
          name: "Remover t4 · executora 2",
        }) === null,
    );
    expect((await teams())[0]?.members.map((m) => m.name)).not.toContain("t4 · executora 2");
  });

  test("Cancelar closes the form; with two hosts with teams, a picker chooses the host", async () => {
    const { store } = await open();
    await click("Novo time");
    await click("Cancelar");
    expect(screen.queryByLabelText("Objetivo")).toBeNull();
    const other = await daemonWithProject("pi");
    await act(() => store.roster.add({ name: "beta", url: other.url, token: other.token }));
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
    await change("Persona da coordenadora (opcional)", "reviewer");
    // A choice among the host's personas, never text typed.
    expect(screen.queryByLabelText("Persona da coordenadora (opcional)")?.tagName).toBe("SELECT");
    await click("Criar e iniciar");
    await settle(() => row("no-pi") !== null);
    const made = await other.teams();
    expect(made.map((t) => t.name)).toEqual(["no-pi"]);
    expect(made[0]?.members[0]?.persona).toBe("reviewer");
  });
});
