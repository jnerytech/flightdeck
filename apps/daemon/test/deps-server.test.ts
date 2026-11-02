import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { startServer } from "../src/server.ts";
import { newBoard } from "./board-helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(20_000);

const TOKEN = "board-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function serve(withBoard = true) {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const server = startServer({
    manager: ctx.manager,
    ...(withBoard ? { board: ctx.board } : {}),
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [ctx.root],
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  const project = withBoard
    ? await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" })
    : null;
  return { ...ctx, client, project };
}

interface WireCard {
  id: string;
  blockedBy: string[];
  blocking: string[];
  waitingOn: string[];
  unblockedAt: string | null;
  autoStart: { workflow: string | null } | null;
}

describe("deps-protocol: over the wire", () => {
  test("a host with a board announces deps, and one without does not", async () => {
    const on = await serve();
    expect((await on.client.data<{ features: string[] }>("host.info", {}))?.features).toContain(
      "deps",
    );
    const off = await serve(false);
    expect(
      (await off.client.data<{ features: string[] }>("host.info", {}))?.features,
    ).not.toContain("deps");
  });

  test("card.create and card.update carry the blockers, and the card shows both ends", async () => {
    const { client, project } = await serve();
    const projectId = project?.id as string;
    const a = await client.data<WireCard>("card.create", {
      projectId,
      title: "A",
      description: "",
    });
    const b = await client.data<WireCard>("card.create", {
      projectId,
      title: "B",
      description: "",
      blockedBy: [a?.id],
    });
    expect(b?.blockedBy).toEqual([a?.id as string]);
    expect(b?.waitingOn).toEqual([a?.id as string]);
    const updated = await client.data<WireCard>("card.update", {
      cardId: b?.id,
      autoStart: { workflow: null },
    });
    expect(updated?.autoStart).toEqual({ workflow: null });
    expect((await client.data<WireCard>("card.get", { cardId: a?.id }))?.blocking).toEqual([
      b?.id as string,
    ]);
  });

  test("a refused link comes back with the reason and the cycle for the app to translate", async () => {
    const { client, project } = await serve();
    const projectId = project?.id as string;
    const a = await client.data<WireCard>("card.create", {
      projectId,
      title: "A",
      description: "",
    });
    const ack = await client.request("card.update", { cardId: a?.id, blockedBy: [a?.id] });
    expect(ack.ok).toBe(false);
    expect(ack.error).toMatchObject({
      code: "invalid_state",
      reason: "blocker_cycle",
      params: { cycle: "A → A" },
    });
  });

  test("starting a blocked card comes back as card_blocked with the titles", async () => {
    const { client, project } = await serve();
    const projectId = project?.id as string;
    const a = await client.data<WireCard>("card.create", {
      projectId,
      title: "A",
      description: "",
    });
    const b = await client.data<WireCard>("card.create", {
      projectId,
      title: "B",
      description: "",
      blockedBy: [a?.id],
    });
    const ack = await client.request("card.start", { cardId: b?.id });
    expect(ack.error).toMatchObject({ reason: "card_blocked", params: { blockers: "A" } });
  });

  test("card.dismissUnblocked clears the mark", async () => {
    const { client, project, board } = await serve();
    const projectId = project?.id as string;
    const a = await client.data<WireCard>("card.create", {
      projectId,
      title: "A",
      description: "",
    });
    const b = await client.data<WireCard>("card.create", {
      projectId,
      title: "B",
      description: "",
      blockedBy: [a?.id],
    });
    board.moveCard(a?.id as string, "done");
    expect(board.getCard(b?.id as string).unblockedAt).not.toBeNull();
    const cleared = await client.data<WireCard>("card.dismissUnblocked", { cardId: b?.id });
    expect(cleared?.unblockedAt).toBeNull();
  });
});
