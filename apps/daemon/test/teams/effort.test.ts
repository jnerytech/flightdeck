import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { ExternalSessions } from "../../src/central/external.ts";
import { LocalEndpoints } from "../../src/messaging/endpoints.ts";
import { Messaging } from "../../src/messaging/messages.ts";
import { ClaudeSdkRuntime, type QueryFn } from "../../src/runtime/claude-sdk-runtime.ts";
import { Teams, type TeamsOptions } from "../../src/teams/teams.ts";
import { newBoard, whenChanged } from "../support/board-helpers.ts";

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function setup(over: Partial<TeamsOptions> = {}) {
  const ctx = newBoard({}, 1);
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const external = new ExternalSessions({ db: ctx.store.db, staleAfterS: 3600 });
  const endpoints = new LocalEndpoints({
    manager: ctx.manager,
    external,
    nameOf: () => null,
    projectKey: () => "github.com/acme/app",
    cardOf: (id) => ctx.board.projectForCwd(ctx.manager.get(id).cwd)?.card?.id ?? null,
    sendToLaunch: () => false,
  });
  cleanups.push(() => endpoints.stop());
  const messaging = new Messaging({
    db: ctx.store.db,
    host: "pc",
    endpoints,
    teamOf: () => null,
  });
  cleanups.push(() => messaging.stop());
  const teams = new Teams({
    db: ctx.store.db,
    board: ctx.board,
    manager: ctx.manager,
    messaging,
    host: "pc",
    ...over,
  });
  cleanups.push(() => teams.stop());
  return { ...ctx, project, teams, messaging };
}

const NEW = { goal: "Review the login.", workers: 2 };

describe("times-esforco: an effort per member (issue #2310)", () => {
  test("the coordinator is started with the effort asked, and a worker's card keeps its own, none meaning the persona's", async () => {
    const asked: Array<string | null> = [];
    const { teams, project, board, manager } = await setup({
      startCoordinator: (input) => {
        asked.push(input.effort);
        return manager.create({ cwd: input.cwd, prompt: input.prompt, name: input.name });
      },
      startWorker: async () => {},
    });
    const team = await teams.create({
      ...NEW,
      projectId: project.id,
      coordinatorEffort: "max",
      workerEfforts: ["low", null],
    });
    expect(asked).toEqual(["max"]);
    const effortOf = (cardId: string | null) =>
      cardId ? (board.getCard(cardId).variant?.effort ?? null) : null;
    expect(team.members.slice(1).map((m) => effortOf(m.cardId))).toEqual(["low", null]);
  });

  test("a team with no effort asked starts everyone with none", async () => {
    const asked: Array<string | null> = [];
    const { teams, project, board, manager } = await setup({
      startCoordinator: (input) => {
        asked.push(input.effort);
        return manager.create({ cwd: input.cwd, prompt: input.prompt, name: input.name });
      },
      startWorker: async () => {},
    });
    const team = await teams.create({ ...NEW, projectId: project.id });
    expect(asked).toEqual([null]);
    expect(
      team.members.slice(1).map((m) => board.getCard(m.cardId as string).variant?.effort ?? null),
    ).toEqual([null, null]);
  });

  test("the coordinator of the default starter reaches the session manager with the effort", async () => {
    const efforts: Array<string | undefined> = [];
    const { teams, project, manager } = await setup({ startWorker: async () => {} });
    const create = manager.create.bind(manager);
    manager.create = (payload, options) => {
      efforts.push(payload.effort);
      return create(payload, options);
    };
    await teams.create({ ...NEW, workers: 1, projectId: project.id, coordinatorEffort: "high" });
    expect(efforts).toEqual(["high"]);
  });

  test("a worker added to a running team opens with the effort asked, and one with none keeps none", async () => {
    const { teams, project, board, messaging } = await setup({ startWorker: async () => {} });
    const team = await teams.create({ ...NEW, workers: 1, projectId: project.id });
    const added = async (effort?: "xhigh" | null) => {
      const next = await teams.update({
        team: team.id,
        addMember: { ...(effort === undefined ? {} : { effort }) },
      });
      const member = next.members[next.members.length - 1];
      return board.getCard(member?.cardId as string).variant?.effort ?? null;
    };
    expect(await added("xhigh")).toBe("xhigh");
    const notice = messaging
      .list({})
      .filter((m) => m.kind === "system" && m.text.includes("Entrou"));
    expect(notice.at(-1)?.text).toContain("esforço xhigh");
    expect(await added(null)).toBeNull();
    expect(await added()).toBeNull();
  });

  test("the card a worker starts from reaches its session with the effort", async () => {
    const { teams, project, board, manager } = await setup();
    const efforts: Array<string | undefined> = [];
    const create = manager.create.bind(manager);
    manager.create = (payload, options) => {
      efforts.push(payload.effort);
      return create(payload, options);
    };
    const team = await teams.create({
      goal: "Review the login.",
      workers: 1,
      projectId: project.id,
      workerEfforts: ["medium"],
    });
    await whenChanged(board, () =>
      team.members.slice(1).every((m) => board.getCard(m.cardId as string).sessionId),
    );
    expect(efforts).toContain("medium");
  });
});

describe("times-esforco: the SDK runtime", () => {
  function optionsOf(start: { effort?: "max"; persona?: { append: string; effort?: "low" } }) {
    const seen: Options[] = [];
    const query: QueryFn = ({ options }) => {
      seen.push(options);
      return {
        async *[Symbol.asyncIterator]() {},
        interrupt: async () => {},
        close: () => {},
      };
    };
    new ClaudeSdkRuntime({ query }).start({
      cwd: "/work",
      permissionMode: "default",
      env: {},
      canUseTool: async () => ({ behavior: "deny", message: "x" }),
      ...start,
    });
    return seen[0] as Options;
  }

  test("an effort asked for the session wins over the persona's, and the persona's stands when none is asked", () => {
    expect(optionsOf({ effort: "max", persona: { append: "x", effort: "low" } }).effort).toBe(
      "max",
    );
    expect(optionsOf({ persona: { append: "x", effort: "low" } }).effort).toBe("low");
  });
});
