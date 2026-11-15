import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import type { Messaging } from "../../src/messaging/messages.ts";
import type { TeamsOptions } from "../../src/teams/options.ts";
import { whenChanged } from "../support/board-helpers.ts";
import { poll } from "../support/helpers.ts";
import { failure, NEW, reasonOf, setup, teardown } from "./teams-setup.ts";

setDefaultTimeout(30_000);
afterEach(teardown);

describe("times: members of a running team", () => {
  async function running(over: Partial<TeamsOptions> = {}) {
    const ctx = await setup({
      personas: { resolve: (id) => (id === "qa" ? { id, name: id } : null) },
      ...over,
    });
    const team = await ctx.teams.create({ ...NEW, projectId: ctx.project.id, name: "time" });
    await whenChanged(ctx.board, () =>
      team.members.slice(1).every((m) => ctx.board.getCard(m.cardId as string).sessionId),
    );
    return { ...ctx, team: ctx.teams.get(team.id) };
  }
  const told = (messaging: Messaging) =>
    messaging.list({}).filter((m) => m.kind === "system" && m.text.includes("Entrou"));

  test("adding a member starts a worker in the persona and model asked for, and tells the coordinator", async () => {
    const { teams, team, board, messaging } = await running();
    const grown = await teams.update({
      team: team.id,
      addMember: { persona: "qa", model: "haiku" },
    });
    const added = grown.members.at(-1);
    expect(added).toMatchObject({
      name: "time · executora 3",
      role: "worker",
      persona: "qa",
      model: "haiku",
    });
    expect(teams.personaOfCard(added?.cardId as string)).toBe("qa");
    expect(board.getCard(added?.cardId as string).variant?.model).toBe("haiku");
    const notice = told(messaging).at(-1)?.text ?? "";
    expect(notice).toContain("time · executora 3");
    expect(notice).toContain("qa");
    expect(notice).toContain("haiku");
    // With nothing asked for, the member takes the defaults.
    const plain = await teams.update({ team: team.id, addMember: {} });
    expect(plain.members.at(-1)).toMatchObject({ persona: null, model: null });
  });

  test("a persona the host does not know refuses the member and creates no card", async () => {
    const { teams, team, board, project } = await running();
    const cards = () => board.getBoard(project.id).columns.flatMap((c) => c.cards).length;
    const before = cards();
    expect(await reasonOf(teams.update({ team: team.id, addMember: { persona: "nada" } }))).toBe(
      "persona_unknown",
    );
    expect(cards()).toBe(before);
    expect(teams.get(team.id).members).toHaveLength(3);
  });

  test("removing a member stops its card, tells the coordinator, and leaves the card on the board", async () => {
    const { teams, team, board, messaging } = await running();
    const stop = spyOn(board, "stopCard");
    const worker = team.members[1];
    const shrunk = await teams.update({ team: team.id, removeMember: worker?.name as string });
    expect(stop).toHaveBeenCalledWith(worker?.cardId as string);
    expect(shrunk.members.map((m) => m.name)).not.toContain(worker?.name as string);
    expect(board.getCard(worker?.cardId as string).id).toBe(worker?.cardId as string);
    expect(
      messaging.list({}).some((m) => m.kind === "system" && m.text.includes("saiu do time")),
    ).toBe(true);
  });

  test("the refusals carry a reason the app can translate", async () => {
    const { teams, team } = await running();
    expect(
      await reasonOf(teams.update({ team: team.id, removeMember: team.coordinator as string })),
    ).toBe("team_coordinator_stays");
    expect(await reasonOf(teams.update({ team: team.id, removeMember: "nada" }))).toBe(
      "team_member_unknown",
    );
    teams.pause(team.id);
    expect(await reasonOf(teams.update({ team: team.id, addMember: {} }))).toBe("team_paused");
    teams.resume(team.id);
    teams.close(team.id, true);
    expect(await reasonOf(teams.update({ team: team.id, addMember: {} }))).toBe("team_closed");
  });
});

// Issue #934: a closed team can be deleted, and nothing of its members goes with it.
describe("times: deleting a team", () => {
  async function closedTeam(over: Partial<TeamsOptions> = {}, realNames = false) {
    const ctx = await setup(over, realNames);
    const created = await ctx.teams.create({ ...NEW, projectId: ctx.project.id, name: "time" });
    await whenChanged(ctx.board, () =>
      created.members.slice(1).every((m) => ctx.board.getCard(m.cardId as string).sessionId),
    );
    // Every member has finished its first turn: none is at work.
    await poll(
      () => ctx.teams.get(created.id).members.every((m) => m.sessionState === "idle") || null,
      10_000,
    );
    ctx.teams.close(created.id, true);
    // The notice that the team closed gives each member a short turn: none is at work after it.
    await poll(
      () => ctx.teams.get(created.id).members.every((m) => m.sessionState === "idle") || null,
      10_000,
    );
    return { ...ctx, team: ctx.teams.get(created.id) };
  }

  test("a closed team with nobody at work is deleted: gone from the list and the books, announced to every watcher", async () => {
    const { teams, team, frames } = await closedTeam();
    const before = frames.length;
    const deleted = teams.delete(team.id);
    expect(deleted.id).toBe(team.id);
    expect(teams.list().map((t) => t.id)).not.toContain(team.id);
    expect(await failure(() => teams.get(team.id))).toContain("not_found");
    // A watcher is told once, with the team as it was: a second app reloads and drops the card.
    expect(frames).toHaveLength(before + 1);
    expect(frames.at(-1)?.team.id).toBe(team.id);
  });

  test("the members' sessions and cards stay, and the sessions are taken out of the team", async () => {
    const { teams, team, board, manager, names } = await closedTeam({}, true);
    const sessions = team.members.flatMap((m) => (m.sessionId ? [m.sessionId] : []));
    expect(sessions).toHaveLength(3);
    for (const member of team.members) {
      const coordinator = member.name === team.coordinator;
      names.assign(member.sessionId as string, {
        project: "app",
        team: { name: "time", role: coordinator ? "coordinator" : "worker", number: null },
      });
    }
    expect(sessions.map((id) => names.get(id)?.team?.name)).toEqual(sessions.map(() => "time"));
    teams.delete(team.id);
    expect(sessions.map((id) => names.get(id)?.team ?? null)).toEqual(sessions.map(() => null));
    for (const sessionId of sessions) expect(manager.get(sessionId).status).not.toBe("ended");
    for (const member of team.members) {
      if (member.cardId) expect(board.getCard(member.cardId).id).toBe(member.cardId);
    }
    expect(teams.teamOf(team.coordinator as string)).toBeNull();
  });

  test("an open team is refused, whatever its members do, and stays", async () => {
    const ctx = await setup();
    const team = await ctx.teams.create({ ...NEW, projectId: ctx.project.id });
    expect(await failure(() => ctx.teams.delete(team.id))).toContain("invalid_state");
    expect(await reasonOf(() => ctx.teams.delete(team.id))).toBe("team_delete_open");
    ctx.teams.pause(team.id);
    expect(await reasonOf(() => ctx.teams.delete(team.id))).toBe("team_delete_open");
    expect(ctx.teams.get(team.id).id).toBe(team.id);
  });

  test("a closed team with a member at work is refused, and goes once it rests", async () => {
    const ctx = await setup();
    const created = await ctx.teams.create({ ...NEW, projectId: ctx.project.id });
    ctx.teams.close(created.id, true);
    const busy = ctx.teams.get(created.id).members.some((m) => m.sessionState === "running");
    expect(busy).toBe(true);
    expect(await reasonOf(() => ctx.teams.delete(created.id))).toBe("team_delete_live");
    expect(ctx.teams.get(created.id).id).toBe(created.id);
    await poll(
      () => ctx.teams.get(created.id).members.every((m) => m.sessionState !== "running") || null,
      10_000,
    );
    expect(ctx.teams.delete(created.id).id).toBe(created.id);
  });

  test("a team that does not exist is not_found", async () => {
    const { teams } = await setup();
    expect(await reasonOf(() => teams.delete("nada"))).toBe("team_not_found");
  });
});

describe("times: damaged stored JSON (#1609)", () => {
  test("a team whose members or checks are damaged is still read, with no members and no checks", async () => {
    const { teams, project, store } = await setup();
    const team = await teams.create({
      ...NEW,
      projectId: project.id,
      name: "login",
      checks: ["bun test"],
    });
    const read = (members: string, checks: string) => {
      store.db
        .query("UPDATE teams SET members = ?, checks = ? WHERE id = ?")
        .run(members, checks, team.id);
      try {
        const got = teams.get(team.id);
        return [got.members.length, got.checks];
      } catch {
        return "threw";
      }
    };
    expect(read("not json", "not json")).toEqual([0, []]);
    expect(read('{"a":1}', '{"a":1}')).toEqual([0, []]);
    expect(read('[{"name":5}]', "[1]")).toEqual([0, []]);
  });
});
