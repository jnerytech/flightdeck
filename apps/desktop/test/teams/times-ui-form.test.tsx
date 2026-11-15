import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  act,
  change,
  click,
  create,
  open,
  row,
  screen,
  settle,
  teardown,
  workerRows,
} from "./times-ui-setup.tsx";

setDefaultTimeout(60_000);
afterEach(teardown);

describe("times-ui: the form of a new team, its worker rows and options", () => {
  test("the form has one row per worker, each with the host's personas and a model, and rows are added and removed", async () => {
    await open();
    await click("Novo time");
    // Two rows to begin with; the persona list of each row is the host's, loaded after the form opens.
    await settle(
      () =>
        (screen.queryByLabelText("Persona da executora 1 (opcional)")?.querySelectorAll("option")
          .length ?? 0) > 5,
    );
    expect(screen.queryByLabelText("Persona da executora 2 (opcional)")).not.toBeNull();
    const model = screen.queryByLabelText("Modelo da executora 1") as HTMLSelectElement | null;
    expect(model?.tagName).toBe("SELECT");
    expect([...(model?.options ?? [])].map((o) => o.value)).toEqual([
      "",
      "opus",
      "sonnet",
      "haiku",
    ]);
    // Adding a row, then removing the first one: the rows renumber and the last row's choice stays.
    await click("Adicionar executora ao novo time");
    await change("Persona da executora 3 (opcional)", "qa");
    await click("Remover a executora 1");
    expect(
      (screen.queryByLabelText("Persona da executora 2 (opcional)") as HTMLSelectElement).value,
    ).toBe("qa");
    expect(screen.queryByLabelText("Persona da executora 3 (opcional)")).toBeNull();
    // The last row cannot be removed: a team has at least one worker.
    await workerRows(1);
    expect(
      (screen.queryByRole("button", { name: "Remover a executora 1" }) as HTMLButtonElement | null)
        ?.disabled,
    ).toBe(true);
  });

  test("the coordinator and each worker open in the model picked, and the default is the persona's own", async () => {
    const { teams } = await open();
    await click("Novo time");
    await change("Objetivo", "com modelos");
    await change("Nome do time", "tm");
    await change("Modelo da coordenadora", "opus");
    await change("Modelo da executora 2", "haiku");
    await click("Criar e iniciar");
    await settle(() => row("tm") !== null);
    const members = (await teams())[0]?.members as Array<{ name: string; model: string | null }>;
    expect(members.map((m) => [m.name, m.model])).toEqual([
      ["tm · coordenadora", "opus"],
      ["tm · executora 1", null],
      ["tm · executora 2", "haiku"],
    ]);
    // The model each member was asked for is shown on its line.
    await settle(() => (row("tm")?.textContent ?? "").includes("haiku"));
    expect(row("tm")?.textContent).toContain("opus");
  });

  test("the coordinator and each worker open in the permission mode picked, and Bypass shows only where the host allows it (#93)", async () => {
    const { teams } = await open();
    await click("Novo time");
    await change("Objetivo", "só planejar");
    await change("Nome do time", "pm");
    const options = (label: string) =>
      [...((screen.queryByLabelText(label) as HTMLSelectElement | null)?.options ?? [])].map(
        (o) => o.value,
      );
    // The host forbids bypass (the default): the choice is not offered, for any member.
    expect(options("Permissões da coordenadora")).toEqual(["", "acceptEdits", "plan"]);
    expect(options("Permissões da executora 1")).toEqual(["", "acceptEdits", "plan"]);
    await change("Permissões da coordenadora", "plan");
    await change("Permissões da executora 2", "acceptEdits");
    await click("Criar e iniciar");
    await settle(() => row("pm") !== null);
    const members = (await teams())[0]?.members as Array<{
      name: string;
      permission: string | null;
    }>;
    expect(members.map((m) => [m.name, m.permission])).toEqual([
      ["pm · coordenadora", "plan"],
      ["pm · executora 1", null],
      ["pm · executora 2", "acceptEdits"],
    ]);
  });

  test("choosing Bypass on a host that allows it asks before the team is created, and cancelling creates nothing (#93)", async () => {
    const { teams } = await open({ bypass: true });
    await click("Novo time");
    await change("Objetivo", "sem perguntas");
    await change("Nome do time", "by");
    await workerRows(1);
    expect(
      [
        ...((screen.queryByLabelText("Permissões da executora 1") as HTMLSelectElement | null)
          ?.options ?? []),
      ].map((o) => o.value),
    ).toEqual(["", "acceptEdits", "plan", "bypassPermissions"]);
    await change("Permissões da executora 1", "bypassPermissions");
    await click("Criar e iniciar");
    await settle(() => screen.queryByRole("alertdialog") !== null);
    await click("Cancelar", screen.queryByRole("alertdialog"));
    await settle(() => screen.queryByRole("alertdialog") === null);
    expect(await teams()).toEqual([]);
    await click("Criar e iniciar");
    await settle(() => screen.queryByRole("alertdialog") !== null);
    await click("Criar sem pedidos de permissão", screen.queryByRole("alertdialog"));
    await settle(() => row("by") !== null);
    const members = (await teams())[0]?.members as Array<{ permission: string | null }>;
    expect(members.map((m) => m.permission)).toEqual([null, "bypassPermissions"]);
  });

  test("a host that does not announce the permission modes shows no picker, so nothing is silently ignored (#93)", async () => {
    const { store } = await open();
    await click("Novo time");
    await settle(() => screen.queryByLabelText("Permissões da executora 1") !== null);
    const host = store.getState().hosts[0];
    await act(async () => {
      (store as unknown as { update(patch: object): void }).update({
        hosts: [
          {
            ...host,
            hostInfo: {
              ...host?.hostInfo,
              features: (host?.hostInfo?.features ?? []).filter((f) => f !== "teams.permissions"),
            },
          },
        ],
      });
    });
    await settle(() => screen.queryByLabelText("Permissões da executora 1") === null);
    expect(screen.queryByLabelText("Modelo da executora 1")).not.toBeNull();
    expect(screen.queryByLabelText("Permissões da coordenadora")).toBeNull();
    expect(screen.queryByLabelText("Permissões da executora 1")).toBeNull();
  });

  test("a worker added to a running team takes a permission mode too (#93)", async () => {
    const { teams } = await open();
    await create("ad", "1");
    await click("Adicionar executora a ad", row("ad"));
    await settle(() => screen.queryByLabelText("Permissões da nova executora de ad") !== null);
    await change("Permissões da nova executora de ad", "plan");
    await click("Adicionar a ad", row("ad"));
    await settle(() => (row("ad")?.textContent ?? "").includes("ad · executora 2"));
    const added = (await teams())[0]?.members.find((m) => m.name === "ad · executora 2");
    expect(added?.permission).toBe("plan");
  });

  test("a Bypass choice is dropped when the host stops allowing it: no confirm, and nothing sent (#93)", async () => {
    const { store, teams } = await open({ bypass: true });
    await click("Novo time");
    await change("Objetivo", "mudou de ideia");
    await change("Nome do time", "fl");
    await workerRows(1);
    await change("Permissões da executora 1", "bypassPermissions");
    const host = store.getState().hosts[0];
    await act(async () => {
      (store as unknown as { update(patch: object): void }).update({
        hosts: [{ ...host, hostInfo: { ...host?.hostInfo, allowBypassPermissions: false } }],
      });
    });
    await settle(
      () =>
        (screen.queryByLabelText("Permissões da executora 1") as HTMLSelectElement | null)
          ?.value === "",
    );
    await click("Criar e iniciar");
    await settle(() => row("fl") !== null);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const members = (await teams())[0]?.members as Array<{ permission: string | null }>;
    expect(members.map((m) => m.permission)).toEqual([null, null]);
  });

  test("a worker added with Bypass asks first, and cancelling adds nothing (#93)", async () => {
    const { teams } = await open({ bypass: true });
    await create("ab", "1");
    await click("Adicionar executora a ab", row("ab"));
    await settle(() => screen.queryByLabelText("Permissões da nova executora de ab") !== null);
    await change("Permissões da nova executora de ab", "bypassPermissions");
    await click("Adicionar a ab", row("ab"));
    await settle(() => screen.queryByRole("alertdialog") !== null);
    await click("Cancelar", screen.queryByRole("alertdialog"));
    await settle(() => screen.queryByRole("alertdialog") === null);
    expect((await teams())[0]?.members.length).toBe(2);
    await click("Adicionar a ab", row("ab"));
    await settle(() => screen.queryByRole("alertdialog") !== null);
    await click("Adicionar sem pedidos de permissão", screen.queryByRole("alertdialog"));
    await settle(() => (row("ab")?.textContent ?? "").includes("ab · executora 2"));
    const added = (await teams())[0]?.members.find((m) => m.name === "ab · executora 2");
    expect(added?.permission).toBe("bypassPermissions");
  });

  /** The effort of each card of a project's board, by card id, read from the daemon. */
  async function efforts(client: { data<T>(type: string, payload: object): Promise<T | null> }) {
    const projects = await client.data<{ projects: Array<{ id: string }> }>("project.list", {});
    const found = new Map<string, string | null>();
    for (const project of projects?.projects ?? []) {
      const board = await client.data<{
        columns: Array<{ cards: Array<{ id: string; variant: { effort: string | null } | null }> }>;
      }>("board.get", { projectId: project.id });
      for (const column of board?.columns ?? []) {
        for (const card of column.cards) found.set(card.id, card.variant?.effort ?? null);
      }
    }
    return found;
  }

  test("each member's effort is picked in the form, the persona's effort standing when none is (#2310)", async () => {
    const { teams, client } = await open();
    await click("Novo time");
    await change("Objetivo", "esforço por membro");
    await change("Nome do time", "ef");
    await workerRows(2);
    const options = (label: string) =>
      [...((screen.queryByLabelText(label) as HTMLSelectElement | null)?.options ?? [])].map(
        (o) => o.value,
      );
    expect(options("Esforço da coordenadora")).toEqual([
      "",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(options("Esforço da executora 1")).toEqual([
      "",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    await change("Esforço da coordenadora", "max");
    await change("Esforço da executora 2", "low");
    await click("Criar e iniciar");
    await settle(() => row("ef") !== null);
    const members = (await teams())[0]?.members ?? [];
    const byCard = await efforts(client);
    expect(members.slice(1).map((m) => byCard.get(m.cardId as string) ?? null)).toEqual([
      null,
      "low",
    ]);
  });

  test("a model with no effort choice hides the picker, and a host that does not announce it shows none (#2310)", async () => {
    const { store } = await open();
    await click("Novo time");
    await settle(() => screen.queryByLabelText("Esforço da executora 1") !== null);
    await change("Modelo da executora 1", "haiku");
    await settle(() => screen.queryByLabelText("Esforço da executora 1") === null);
    expect(screen.queryByLabelText("Esforço da executora 2")).not.toBeNull();
    const host = store.getState().hosts[0];
    await act(async () => {
      (store as unknown as { update(patch: object): void }).update({
        hosts: [
          {
            ...host,
            hostInfo: {
              ...host?.hostInfo,
              features: (host?.hostInfo?.features ?? []).filter((f) => f !== "teams.effort"),
            },
          },
        ],
      });
    });
    await settle(() => screen.queryByLabelText("Esforço da executora 2") === null);
    expect(screen.queryByLabelText("Esforço da coordenadora")).toBeNull();
    expect(screen.queryByLabelText("Modelo da executora 2")).not.toBeNull();
  });

  test("a worker added to a running team takes an effort too (#2310)", async () => {
    const { teams, client } = await open();
    await create("ae", "1");
    await click("Adicionar executora a ae", row("ae"));
    await settle(() => screen.queryByLabelText("Esforço da nova executora de ae") !== null);
    await change("Esforço da nova executora de ae", "xhigh");
    await click("Adicionar a ae", row("ae"));
    await settle(() => (row("ae")?.textContent ?? "").includes("ae · executora 2"));
    const added = (await teams())[0]?.members.find((m) => m.name === "ae · executora 2");
    expect((await efforts(client)).get(added?.cardId as string)).toBe("xhigh");
  });

  test("the worker rows are a grid of fixed columns: persona, model, permissions, remove (#93)", async () => {
    await open();
    await click("Novo time");
    await workerRows(2);
    const rows = [...document.querySelectorAll<HTMLElement>("[data-slot='worker-row']")];
    expect(rows.length).toBe(2); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    for (const item of rows) expect(item.className.split(" ")).toContain("worker-row");
  });
});
