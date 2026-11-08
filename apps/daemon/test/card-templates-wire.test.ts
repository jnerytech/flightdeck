import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { templateRootOf } from "../src/board/spec-template.ts";
import { startServer } from "../src/server.ts";
import { newBoard } from "./board-helpers.ts";
import { BASELINE_FEATURES } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

/** Issue #1201: over the wire, a host with a board announces cardTemplates, lists them and fills a card from one. */
setDefaultTimeout(20_000);

const TOKEN = "board-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function serve(withBoard = true) {
  const ctx = newBoard({
    specTemplateRoot: async (cwd, own) => templateRootOf({ trusted: true }, own ? cwd : undefined),
  });
  cleanups.push(() => ctx.board.stop());
  mkdirSync(join(ctx.repo, ".flightdeck", "templates"), { recursive: true });
  writeFileSync(
    join(ctx.repo, ".flightdeck", "templates", "cards.json"),
    JSON.stringify([
      { id: "bug", name: "Bug fix", criteria: ["a test fails first"], workflow: "fix" },
    ]),
  );
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

describe("card-templates-wire: a project's card templates over the wire (#1201)", () => {
  test("a host with a board announces cardTemplates, and one without does not", async () => {
    const featuresOf = async (client: FrameClient) =>
      ((await client.data<{ features: string[] }>("host.info", {}))?.features ?? []).filter(
        (name) => !BASELINE_FEATURES.includes(name),
      );
    const on = await serve();
    const off = await serve(false);
    expect([
      (await featuresOf(on.client)).includes("cardTemplates"),
      (await featuresOf(off.client)).includes("cardTemplates"),
    ]).toEqual([true, false]);
  });

  test("card.templates lists them, and card.create with templateId fills the card", async () => {
    const { client, project } = await serve();
    const listed = await client.data<{ templates: Array<{ id: string }> }>("card.templates", {
      projectId: project.id,
    });
    const card = await client.data<{ description: string; startWorkflow: string | null }>(
      "card.create",
      { projectId: project.id, title: "Login fails", description: "", templateId: "bug" },
    );
    expect([listed?.templates.map((t) => t.id), card?.description, card?.startWorkflow]).toEqual([
      ["bug"],
      "- [ ] a test fails first",
      "fix",
    ]);
  });

  test("card.create with a template the project does not offer is refused and makes no card", async () => {
    const { client, project } = await serve();
    const refused = await client.request("card.create", {
      projectId: project.id,
      title: "x",
      description: "",
      templateId: "nope",
    });
    expect(refused.ok).toBe(false);
  });
});
