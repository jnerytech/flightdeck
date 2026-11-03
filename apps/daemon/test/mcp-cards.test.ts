import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Card } from "@flightdeck/protocol";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runCli } from "../src/main.ts";
import { startServer } from "../src/server.ts";
import { git, newBoard } from "./board-helpers.ts";
import { poll, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(20_000);
const TOKEN = "mcp-cards-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A daemon with two projects, the first with a started card (a managed session in its worktree). */
async function setup() {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const one = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const other = join(ctx.root, "outro");
  mkdirSync(other);
  git(other, "init", "-q", "-b", "main");
  git(other, "config", "commit.gpgsign", "false");
  writeFileSync(join(other, "README.md"), "# outro\n");
  git(other, "add", ".");
  git(other, "commit", "-q", "-m", "inicial");
  const two = await ctx.board.addProject({ path: other, promptTemplate: "" });
  const mine = ctx.board.createCard(one.id, { title: "Meu", description: "d" });
  const sibling = ctx.board.createCard(one.id, { title: "Irmão", description: "" });
  const foreign = ctx.board.createCard(two.id, { title: "Alheio", description: "" });
  await ctx.board.startCard(mine.id, {});
  const sessionId = (await poll(() => ctx.board.getCard(mine.id).sessionId)) as string;
  const server = startServer({
    manager: ctx.manager,
    board: ctx.board,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [ctx.root],
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(`ws://127.0.0.1:${server.port}/v1/ws`);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  /** The card, or `code/reason` of the refusal. */
  const manage = async (payload: Record<string, unknown>, as: object = { session: sessionId }) => {
    const ack = await client.request("card.manage", { as, ...payload });
    if (ack.ok === true) return ack.data as Card;
    const error = ack.error as { code?: string; reason?: string };
    return `${error.code}/${error.reason}`;
  };
  const free = (await ctx.manager.create({ cwd: ctx.repo, prompt: "solta" })).sessionId;
  const lost = (await ctx.manager.create({ cwd: ctx.root, prompt: "fora" })).sessionId;
  return { ...ctx, mine, sibling, foreign, sessionId, free, lost, manage, server };
}

describe("mcp-cards: a session manages the cards of its own project", () => {
  test("its own card is the default: move changes the column and the board is told", async () => {
    const { board, mine, manage } = await setup();
    const seen: string[] = [];
    board.watch((card) => seen.push(`${card.id}:${card.column}`));
    const moved = await manage({ action: "move", column: "review" });
    expect((moved as Card).column).toBe("review");
    expect(board.getCard(mine.id).column).toBe("review");
    expect(seen).toContain(`${mine.id}:review`);
  });

  test("another card of the same project can be named; one of another project is refused", async () => {
    const { board, sibling, foreign, manage } = await setup();
    expect(
      ((await manage({ action: "move", cardId: sibling.id, column: "done" })) as Card).column,
    ).toBe("done");
    expect(await manage({ action: "move", cardId: foreign.id, column: "done" })).toBe(
      "invalid_state/card_other_project",
    );
    expect(board.getCard(foreign.id).column).toBe("backlog");
  });

  test("outside every project it refuses; in the project but not in a card it needs the card id", async () => {
    const { lost, free, sibling, manage } = await setup();
    expect(await manage({ action: "move", column: "done" }, { session: lost })).toBe(
      "invalid_state/card_scope_unknown",
    );
    expect(await manage({ action: "move", column: "done" }, { session: free })).toBe(
      "invalid_state/card_id_needed",
    );
    // A session id the manager does not know has no folder, so it is outside every project.
    expect(await manage({ action: "move", column: "done" }, { session: "unknown-session" })).toBe(
      "invalid_state/card_scope_unknown",
    );
    expect(
      (
        (await manage(
          { action: "move", cardId: sibling.id, column: "waiting" },
          { session: free },
        )) as Card
      ).column,
    ).toBe("waiting");
  });

  test("update changes the title and the description; nothing to change is refused", async () => {
    const { board, mine, manage } = await setup();
    await manage({ action: "update", title: "Novo", description: "texto" });
    expect(board.getCard(mine.id)).toMatchObject({ title: "Novo", description: "texto" });
    expect(await manage({ action: "update" })).toBe("invalid_state/card_manage_args");
    expect(await manage({ action: "move" })).toBe("invalid_state/card_manage_args");
  });

  test("a comment is appended to the description, dated, and keeps what was there", async () => {
    const { board, mine, manage } = await setup();
    await manage({ action: "comment", text: "primeira" });
    await manage({ action: "comment", text: "segunda" });
    const description = board.getCard(mine.id).description;
    expect(description.startsWith("d\n\n")).toBe(true);
    expect(description).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}.*primeira[\s\S]*segunda/);
    expect(await manage({ action: "comment" })).toBe("invalid_state/card_manage_args");
  });

  test("finish done completes the card; without an outcome it is refused", async () => {
    const { sibling, manage } = await setup();
    const done = (await manage({ action: "finish", cardId: sibling.id, outcome: "done" })) as Card;
    expect(done.column).toBe("done");
    expect(await manage({ action: "finish" })).toBe("invalid_state/card_manage_args");
  });

  test("discard removes the card from the board", async () => {
    const { board, mine, manage } = await setup();
    const gone = (await manage({ action: "finish", outcome: "discard" })) as Card;
    expect(gone.discarded).toBe(true);
    expect(() => board.getCard(mine.id)).toThrow();
  });
});

describe("mcp-cards: the MCP tools", () => {
  test("move_card, update_card, comment_card and finish_card call it as the session, in its folder", async () => {
    const ctx = await setup();
    const file = join(tempDir(), "config.json");
    writeFileSync(
      file,
      JSON.stringify({ token: TOKEN, port: ctx.server.port, dataDir: join(tempDir(), "data") }),
    );
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await runCli(["mcp", "--config", file], {
      env: { FLIGHTDECK_SESSION: ctx.sessionId },
      log: { log: () => {}, error: () => {} },
      exit: () => {},
      onSignal: () => {},
      mcpTransport: serverSide,
    });
    const client = new Client({ name: "teste", version: "1.0.0" });
    await client.connect(clientSide);
    cleanups.push(() => client.close());
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      const text = (result.content as Array<{ text?: string }>)[0]?.text ?? "";
      return result.isError ? { error: text } : { data: JSON.parse(text) as Card };
    };
    expect((await call("move_card", { column: "review" })).data?.column).toBe("review");
    expect((await call("update_card", { title: "Pelo MCP" })).data?.title).toBe("Pelo MCP");
    expect((await call("comment_card", { text: "nota" })).data?.description).toContain("nota");
    expect(
      (await call("move_card", { cardId: ctx.foreign.id, column: "done" })).error ?? "",
    ).toContain("another project");
    expect((await call("finish_card", { outcome: "done" })).data?.column).toBe("done");
  });
});
