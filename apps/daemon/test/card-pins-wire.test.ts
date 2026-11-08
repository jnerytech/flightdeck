import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { startServer } from "../src/server.ts";
import { newBoard } from "./board-helpers.ts";
import { BASELINE_FEATURES } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

/** Issue #76: over the wire, a card's pinned documents are announced, set and refused. */
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
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  return { ...ctx, client, project };
}

const featuresOf = async (client: FrameClient) =>
  ((await client.data<{ features: string[] }>("host.info", {}))?.features ?? []).filter(
    (name) => !BASELINE_FEATURES.includes(name),
  );

describe("card-pins-wire: pinned documents over the wire (#76)", () => {
  test("a host with a board announces cardPins, and one without does not", async () => {
    const on = await serve();
    const off = await serve(false);
    expect([
      (await featuresOf(on.client)).includes("cardPins"),
      (await featuresOf(off.client)).includes("cardPins"),
    ]).toEqual([true, false]);
  });

  test("card.update sets the pins and the card answers with them; a path outside the library is refused", async () => {
    const { client, project } = await serve();
    const card = await client.data<{ id: string }>("card.create", {
      projectId: project.id,
      title: "A",
      description: "",
    });
    const updated = await client.data<{ pinnedDocs: string[] }>("card.update", {
      cardId: card?.id,
      pinnedDocs: ["docs/adr/0001-a.md", "docs/specs/b.md"],
    });
    expect(updated?.pinnedDocs).toEqual(["docs/adr/0001-a.md", "docs/specs/b.md"]);
    const refused = await client.request("card.update", {
      cardId: card?.id,
      pinnedDocs: ["README.md"],
    });
    const still = await client.data<{ pinnedDocs: string[] }>("card.get", { cardId: card?.id });
    expect([refused.ok, still?.pinnedDocs]).toEqual([
      false,
      ["docs/adr/0001-a.md", "docs/specs/b.md"],
    ]);
  });
});
