import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command, ServerMessage } from "@flightdeck/protocol";
import { installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { loadConfig } from "../src/config.ts";
import { startDaemon } from "../src/main.ts";
import { startServer } from "../src/server.ts";
import { git, gitRepo, newBoard } from "./board-helpers.ts";
import { newManager, poll, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

// Real git and fake CLIs (each one a Bun process) in several waits: more than the default 5 s.
setDefaultTimeout(20_000);

const TOKEN = "board-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

interface WireCard {
  id: string;
  title: string;
  description: string;
  column: string;
  position: number;
  sessionId: string | null;
  sessionStatus: string | null;
  prUrl: string | null;
  discarded: boolean;
}

async function connect(url: string): Promise<FrameClient> {
  const client = new FrameClient(url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return client;
}

function serve() {
  const ctx = newBoard({ prPollIntervalMs: 30 });
  cleanups.push(() => ctx.board.stop());
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
  return { ...ctx, server };
}

/** `card.updated` frames for one card, in arrival order. */
const updates = (client: FrameClient, cardId: string): WireCard[] =>
  client.frames
    .filter((f) => f.type === "card.updated" && (f.card as WireCard).id === cardId)
    .map((f) => f.card as WireCard);

/** Next `card.updated` for the card, after the first `seen` ones, that satisfies `check`. */
const nextUpdate = (
  client: FrameClient,
  cardId: string,
  seen: number,
  check: (card: WireCard) => boolean = () => true,
) => poll(() => updates(client, cardId).slice(seen).find(check), 3000);

describe("protocolo-board", () => {
  test("project.add, project.update e project.list, com maxParallelRuns do host", async () => {
    const { server, repo } = serve();
    const client = await connect(server.url);
    const outside = await client.request("project.add", { path: tempDir() });
    expect(outside).toMatchObject({ ok: false, error: { code: "forbidden_cwd" } });
    const project = await client.data<{ id: string; name: string }>("project.add", {
      path: repo,
      prProvider: "github",
    });
    expect(project?.name).toBe("repo");
    const updated = await client.data<{ name: string; setupScript: string | null }>(
      "project.update",
      { projectId: project?.id, name: "Renomeado", setupScript: "bun install" },
    );
    expect(updated).toMatchObject({ name: "Renomeado", setupScript: "bun install" });
    const listed = await client.data<{ projects: Array<{ id: string }>; maxParallelRuns: number }>(
      "project.list",
      {},
    );
    expect(listed?.projects.map((p) => p.id)).toEqual([project?.id ?? ""]);
    expect(listed?.maxParallelRuns).toBe(2);
    expect(await client.data("board.settings", { maxParallelRuns: 3 })).toEqual({
      maxParallelRuns: 3,
    });
    expect(await client.data("board.settings", {})).toEqual({ maxParallelRuns: 3 });
  });

  test("board.get devolve as cinco colunas, cada uma com seus cards em ordem", async () => {
    const { server, repo } = serve();
    const client = await connect(server.url);
    const project = await client.data<{ id: string }>("project.add", { path: repo });
    const projectId = project?.id ?? "";
    const create = (title: string) =>
      client.data<WireCard>("card.create", { projectId, title, description: "d" });
    const a = await create("A");
    const b = await create("B");
    const c = await create("C");
    await client.data("card.move", { cardId: c?.id, column: "backlog", position: 0.5 });
    await client.data("card.move", { cardId: b?.id, column: "review" });
    const board = await client.data<{
      project: { id: string };
      columns: Array<{ column: string; cards: WireCard[] }>;
    }>("board.get", { projectId });
    expect(board?.project.id).toBe(projectId);
    expect(board?.columns.map((col) => col.column)).toEqual([
      "backlog",
      "in_progress",
      "waiting",
      "review",
      "done",
    ]);
    expect(board?.columns.map((col) => col.cards.map((card) => card.title))).toEqual([
      ["C", "A"],
      [],
      [],
      ["B"],
      [],
    ]);
    expect(a?.column).toBe("backlog");
    const missing = await client.request("board.get", { projectId: "nao-existe" });
    expect(missing).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  test("board.watch recebe card.updated após cada mudança", async () => {
    const { server, root, repo } = serve();
    git(root, "init", "-q", "--bare", "remote.git");
    git(repo, "remote", "add", "origin", join(root, "remote.git"));
    expect(git(repo, "remote", "get-url", "origin")).toBe(join(root, "remote.git"));
    const gh = installFakeCli("gh", [
      { args: ["view", "url"], code: 1 },
      { args: ["pr", "create"], stdout: "https://github.com/acme/repo/pull/1\n" },
      { args: ["view", "state,statusCheckRollup"], stdout: JSON.stringify({ state: "OPEN" }) },
    ]);
    cleanups.push(gh.restore);
    const client = await connect(server.url);
    expect((await client.request("board.watch", {})).ok).toBe(true);
    const project = await client.data<{ id: string }>("project.add", {
      path: repo,
      prProvider: "github",
      promptTemplate: "",
    });

    const card = await client.data<WireCard>("card.create", {
      projectId: project?.id,
      title: "Pelo protocolo",
      description: "crie [commit]",
    });
    const id = card?.id ?? "";
    expect(await nextUpdate(client, id, 0, (c) => c.column === "backlog")).not.toBeNull();

    let seen = updates(client, id).length;
    await client.data("card.update", { cardId: id, title: "Novo título" });
    expect(await nextUpdate(client, id, seen, (c) => c.title === "Novo título")).not.toBeNull();

    seen = updates(client, id).length;
    await client.data("card.move", { cardId: id, column: "waiting" });
    expect(await nextUpdate(client, id, seen, (c) => c.column === "waiting")).not.toBeNull();

    seen = updates(client, id).length;
    const started = await client.data<WireCard>("card.start", { cardId: id });
    expect(started?.column).toBe("in_progress");
    expect(await nextUpdate(client, id, seen, (c) => c.column === "in_progress")).not.toBeNull();
    // turn.result moves the card first; the session's idle comes in the next update.
    const reviewed = await nextUpdate(
      client,
      id,
      seen,
      (c) => c.column === "review" && c.sessionStatus === "idle",
    );
    expect(reviewed).not.toBeNull();

    const diff = await client.data<{ files: Array<{ path: string }> }>("card.diff", {
      cardId: id,
    });
    expect(diff?.files.map((f) => f.path)).toEqual(["fake-1.txt"]);

    seen = updates(client, id).length;
    expect(await client.data("card.message", { cardId: id, text: "ajuste [commit]" })).toEqual({
      queued: false,
    });
    expect(await nextUpdate(client, id, seen, (c) => c.column === "in_progress")).not.toBeNull();
    expect(await nextUpdate(client, id, seen, (c) => c.column === "review")).not.toBeNull();

    seen = updates(client, id).length;
    expect((await client.data<WireCard>("card.stop", { cardId: id }))?.id).toBe(id);

    seen = updates(client, id).length;
    const opened = await client.data<WireCard>("card.pr.create", { cardId: id });
    expect(opened?.prUrl).toBe("https://github.com/acme/repo/pull/1");
    expect(await nextUpdate(client, id, seen, (c) => c.prUrl !== null)).not.toBeNull();

    const refused = await client.request("card.complete", { cardId: id });
    expect(refused).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    seen = updates(client, id).length;
    await client.data("card.complete", { cardId: id, confirm: true });
    expect(await nextUpdate(client, id, seen, (c) => c.column === "done")).not.toBeNull();

    const noConfirm = await client.request("card.discard", { cardId: id });
    expect(noConfirm).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    seen = updates(client, id).length;
    const discarded = await client.data<WireCard>("card.discard", { cardId: id, confirm: true });
    expect(discarded?.discarded).toBe(true);
    expect(await nextUpdate(client, id, seen, (c) => c.discarded)).not.toBeNull();
  });

  test("card.message em card sem sessão é recusado; depois de fechar a conexão o watch para", async () => {
    const { server, repo, board } = serve();
    const client = await connect(server.url);
    await client.request("board.watch", {});
    await client.request("board.watch", {});
    const project = await client.data<{ id: string }>("project.add", { path: repo });
    const card = await client.data<WireCard>("card.create", {
      projectId: project?.id,
      title: "Parado",
      description: "d",
    });
    const refused = await client.request("card.message", { cardId: card?.id, text: "oi" });
    expect(refused).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    // Watching twice on the same connection still gives one frame per change.
    expect(updates(client, card?.id ?? "")).toHaveLength(1);
    client.close();
    await Bun.sleep(50);
    board.updateCard(card?.id ?? "", { description: "depois" });
    expect(board.watcherCount).toBe(0);
  });

  test("um watcher que lança não quebra o board nem os outros watchers", async () => {
    const { board, repo } = serve();
    const seen: string[] = [];
    board.watch(() => {
      throw new Error("watcher quebrado");
    });
    board.watch((card) => seen.push(card.title));
    const project = await board.addProject({ path: repo });
    const card = (() => {
      try {
        return board.createCard(project.id, { title: "Resiste", description: "d" });
      } catch {
        return null;
      }
    })();
    expect(card?.title).toBe("Resiste");
    expect(seen).toEqual(["Resiste"]);
  });

  test("daemon sem board responde invalid_state", async () => {
    const { manager } = newManager();
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => server.stop());
    const client = await connect(server.url);
    const ack = await client.request("project.list", {});
    expect(ack).toMatchObject({ ok: false, error: { code: "invalid_state" } });
  });

  test("startDaemon liga o board com maxParallelRuns e board.prPollIntervalMs da config, e grava o limite", async () => {
    const { root, repo } = gitRepo();
    const dir = tempDir();
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        port: 0,
        token: TOKEN,
        dataDir: join(dir, "data"),
        allowedRoots: [root],
        maxParallelRuns: 1,
        board: { prPollIntervalMs: 50 },
        history: { roots: [join(dir, "nada")] },
      }),
    );
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
    );
    cleanups.push(() => daemon.stop());
    const client = await connect(daemon.url);
    expect(await client.data<{ id: string }>("project.add", { path: repo })).not.toBeNull();
    const listed = await client.data<{ maxParallelRuns: number }>("project.list", {});
    expect(listed?.maxParallelRuns).toBe(1);
    await client.data("board.settings", { maxParallelRuns: 4 });
    expect(loadConfig(file).maxParallelRuns).toBe(4);
  });

  test("exemplos do protocolo", () => {
    const commands = [
      { type: "project.list", payload: {} },
      { type: "project.add", payload: { path: "/r", prProvider: "azure-devops" } },
      { type: "project.update", payload: { projectId: "p", setupScript: null } },
      { type: "board.get", payload: { projectId: "p" } },
      { type: "board.settings", payload: { maxParallelRuns: 2 } },
      { type: "board.watch", payload: {} },
      { type: "card.create", payload: { projectId: "p", title: "t", description: "d" } },
      { type: "card.update", payload: { cardId: "c", description: "d" } },
      { type: "card.move", payload: { cardId: "c", column: "done", position: 2 } },
      { type: "card.start", payload: { cardId: "c" } },
      { type: "card.stop", payload: { cardId: "c" } },
      { type: "card.diff", payload: { cardId: "c" } },
      { type: "card.message", payload: { cardId: "c", text: "ajuste" } },
      { type: "card.pr.create", payload: { cardId: "c" } },
      { type: "card.complete", payload: { cardId: "c", confirm: true } },
      { type: "card.discard", payload: { cardId: "c", confirm: true } },
    ];
    for (const [i, command] of commands.entries()) {
      expect(Command.safeParse({ id: String(i), ...command }).success).toBe(true);
    }
    const bad = { id: "x", type: "card.move", payload: { cardId: "c", column: "lixo" } };
    expect(Command.safeParse(bad).success).toBe(false);
    const card = {
      id: "c",
      projectId: "p",
      title: "t",
      description: "d",
      column: "review",
      columnLocked: false,
      position: 1,
      slug: "t",
      branch: "fd/t",
      worktreePath: "/r/.flightdeck/worktrees/t",
      prUrl: null,
      prState: null,
      checksState: null,
      queued: false,
      sessionId: "s",
      sessionStatus: "idle",
      notice: null,
      discarded: false,
      runs: [{ sessionId: "s", queuedAt: "a", startedAt: "b", endedAt: null }],
      createdAt: "a",
      updatedAt: "b",
    };
    expect(ServerMessage.safeParse({ type: "card.updated", card }).success).toBe(true);
  });
});
