import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Messaging } from "../../src/messaging/messages.ts";
import { whenChanged } from "../support/board-helpers.ts";
import { failure, NEW, setup, teardown } from "./teams-setup.ts";

setDefaultTimeout(30_000);
afterEach(teardown);

describe("times: os controles", () => {
  async function running() {
    const ctx = await setup();
    const team = await ctx.teams.create({ ...NEW, projectId: ctx.project.id, name: "time" });
    await whenChanged(ctx.board, () =>
      team.members.slice(1).every((m) => ctx.board.getCard(m.cardId as string).sessionId),
    );
    const fresh = ctx.teams.get(team.id);
    return { ...ctx, team: fresh };
  }
  const stops = (messaging: Messaging) =>
    messaging.list({}).filter((m) => m.kind === "system" && m.text.startsWith("STOP"));

  test("pausar manda STOP a todos, retomar manda resume, e pausar duas vezes não repete", async () => {
    const { teams, messaging, team, frames } = await running();
    const paused = teams.pause(team.id);
    expect(paused).toMatchObject({ state: "paused", pausedBy: "user" });
    expect(stops(messaging)).toHaveLength(3);
    expect(stops(messaging)[0]?.text).toContain("ponto seguro");
    expect(teams.pause(team.id).state).toBe("paused");
    expect(stops(messaging)).toHaveLength(3);
    const resumed = teams.resume(team.id);
    expect(resumed).toMatchObject({ state: "active", pausedBy: null });
    expect(messaging.list({}).filter((m) => m.text.startsWith("resume"))).toHaveLength(3);
    expect(teams.resume(team.id).state).toBe("active");
    expect(frames.map((f) => f.team.state)).toContain("paused");
  });

  test("mandar a todos entrega o texto a cada membro", async () => {
    const { teams, team, messaging } = await running();
    const result = teams.message(team.id, "mudança de rumo: use SQLite");
    expect(result).toEqual({ delivered: 3, refused: 0 });
    expect(messaging.list({ team: team.id }).filter((m) => m.text.includes("SQLite"))).toHaveLength(
      3,
    );
  });

  test("trocar a persona de um membro registra e avisa a sessão; persona que não existe é recusada", async () => {
    const applied: Array<[string, string | null]> = [];
    const ctx = await setup({
      personas: { resolve: (id) => (id === "qa" ? { id, name: id } : null) },
      applyPersona: (sessionId, persona) => applied.push([sessionId, persona]),
    });
    const team = await ctx.teams.create({ ...NEW, projectId: ctx.project.id });
    const target = team.members[0]?.address as string;
    const changed = await ctx.teams.update({
      team: team.id,
      persona: { member: target, persona: "qa" },
    });
    expect(changed.members[0]?.persona).toBe("qa");
    expect(applied).toEqual([[team.coordinator as string, "qa"]]);
    const cleared = await ctx.teams.update({
      team: team.id,
      persona: { member: target, persona: null },
    });
    expect(cleared.members[0]?.persona).toBeNull();
    expect(
      await failure(
        ctx.teams.update({ team: team.id, persona: { member: target, persona: "nada" } }),
      ),
    ).toContain("bad_request");
    expect(
      await failure(
        ctx.teams.update({ team: team.id, persona: { member: "pc/fantasma", persona: "qa" } }),
      ),
    ).toContain("not_found");
  });

  test("acrescentar uma executora cria o card dela e avisa a coordenadora; tirar uma tira só do time", async () => {
    const { teams, team, messaging, board } = await running();
    const grown = await teams.update({ team: team.id, addWorkers: 1 });
    expect(grown.members.map((m) => m.name).at(-1)).toBe(`${team.name} · executora 3`);
    expect(
      messaging.list({}).some((m) => m.kind === "system" && m.text.includes("executora 3")),
    ).toBe(true);
    const removed = grown.members[1];
    const shrunk = await teams.update({ team: team.id, removeMember: removed?.cardId as string });
    expect(shrunk.members).toHaveLength(3);
    expect(shrunk.members.some((m) => m.cardId === removed?.cardId)).toBe(false);
    // The card stays on the board: only the membership goes.
    expect(board.getCard(removed?.cardId as string).id).toBe(removed?.cardId as string);
    expect(
      await failure(teams.update({ team: team.id, removeMember: team.coordinator as string })),
    ).toContain("coordinator does not leave");
    expect(await failure(teams.update({ team: team.id, removeMember: "nada" }))).toContain(
      "not_found",
    );
  });

  test("o objetivo e os checks mudam, e uma mensagem avisa a coordenadora", async () => {
    const { teams, team, messaging } = await running();
    const changed = await teams.update({
      team: team.id,
      goal: "novo objetivo",
      checks: ["bun test"],
    });
    expect(changed).toMatchObject({ goal: "novo objetivo", checks: ["bun test"] });
    expect(messaging.list({}).some((m) => m.text.includes("novo objetivo"))).toBe(true);
    // Clearing the checks goes back to the project's own, and says so.
    const cleared = await teams.update({ team: team.id, checks: [] });
    expect(cleared.checks).toEqual([]);
    expect(
      messaging.list({}).some((m) => m.text.includes("voltaram a ser os checks do projeto")),
    ).toBe(true);
  });

  test("encerrar pede confirmação, avisa os membros e o time deixa de aceitar controles", async () => {
    const { teams, team, messaging } = await running();
    expect(await failure(() => teams.close(team.id, false))).toContain("confirm");
    const closed = teams.close(team.id, true);
    expect(closed.state).toBe("closed");
    expect(messaging.list({}).filter((m) => m.text.includes("encerrado"))).toHaveLength(3);
    expect(await failure(() => teams.pause(team.id))).toContain("is closed");
    expect(await failure(() => teams.message(team.id, "oi"))).toContain("is closed");
    expect(await failure(teams.update({ team: team.id, goal: "x" }))).toContain("is closed");
    expect(teams.close(team.id, true).state).toBe("closed");
    expect(teams.teamOf(team.coordinator as string)).toBeNull();
  });

  test("um time que não existe é not_found", async () => {
    const { teams } = await running();
    expect(await failure(() => teams.get("nada"))).toContain("not_found");
    expect(await failure(() => teams.pause("nada"))).toContain("not_found");
  });
});
