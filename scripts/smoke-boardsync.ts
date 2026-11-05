#!/usr/bin/env bun
/**
 * Board sync smoke (phase 38): a `--runtime fake` daemon and a fake `gh` that answers the GitHub
 * Projects GraphQL calls. A project is linked to the board and its two items become cards; a move
 * made here is not sent while push is off; push needs the confirm; with push on the move reaches
 * the board (the mutation carries the option id); a change on the board that is newer than a local
 * move wins and the move that lost is in the card's log; unlinking keeps the cards.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Ack, parseServerMessage } from "@flightdeck/protocol";
import {
  assertCheckGuardActive,
  assertNoRefusedChecks,
  installCheckGuard,
} from "./test/check-guard.ts";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./test/cli-guard.ts";
import { installFakeCli } from "./test/fake-cli.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";
import { realTempDir } from "./test/temp-dir.ts";

// The daemon inherits PATH and HOME: neither the real `claude`, `gh` and `az` nor `~/.claude`.
const clis = installCliGuard();
const guard = installClaudeGuard();
const home = installHomeGuard();
const checks = installCheckGuard();
assertCheckGuardActive(checks);
assertCliGuardActive(clis);
// The home guard hides ~/.gitconfig: the commits need an identity.
Object.assign(process.env, {
  GIT_AUTHOR_NAME: "Flightdeck Smoke",
  GIT_AUTHOR_EMAIL: "smoke@flightdeck.invalid",
  GIT_COMMITTER_NAME: "Flightdeck Smoke",
  GIT_COMMITTER_EMAIL: "smoke@flightdeck.invalid",
});

const TIMEOUT_MS = 20_000;
const ROOT = resolve(import.meta.dir, "..");

let step = "preparar";
const log = (msg: string) => console.log(`  · ${msg}`);

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, fail) =>
      setTimeout(() => fail(new Error(`timeout: ${what}`)), TIMEOUT_MS),
    ),
  ]);
}

class Client {
  private ws!: WebSocket;
  private readonly acks = new Map<string, (ack: Ack) => void>();
  private seq = 0;

  constructor(private readonly url: string) {}

  async open(token: string): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (msg) => {
      const parsed = parseServerMessage(String(msg.data));
      if (parsed.type === "ack") this.acks.get(parsed.id)?.(parsed);
      else if (parsed.type === "ping")
        this.ws.send(JSON.stringify({ type: "pong", id: parsed.id }));
    });
    await withTimeout(
      new Promise<void>((ok, fail) => {
        this.ws.addEventListener("open", () => ok(), { once: true });
        this.ws.addEventListener("error", () => fail(new Error("falha ao conectar")), {
          once: true,
        });
      }),
      "conectar",
    );
    await this.call("hello", { token, client: "smoke-boardsync" });
  }

  async call<T = unknown>(type: string, payload: unknown): Promise<T> {
    const id = String(++this.seq);
    const ack = new Promise<Ack>((ok) => this.acks.set(id, ok));
    this.ws.send(JSON.stringify({ id, type, payload }));
    const result = await withTimeout(ack, `ack de ${type}`);
    if (!result.ok) {
      throw new Error(
        `${type}: ${result.error.code} ${result.error.reason ?? ""} ${result.error.message}`.trim(),
      );
    }
    return result.data as T;
  }

  /** The error of a call that should fail: `type: code reason`. */
  async fail(type: string, payload: unknown): Promise<string> {
    return this.call(type, payload).then(
      () => "conseguiu",
      (error: Error) => error.message,
    );
  }

  close(): void {
    this.ws.close();
  }
}

async function readListenUrl(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const match = buffer.match(/listening on (ws:\/\/\S+)/);
    if (match?.[1]) return match[1];
  }
  throw new Error(`daemon saiu sem anunciar a porta: ${buffer}`);
}

function git(cwd: string, ...args: string[]): string {
  const proc = Bun.spawnSync(["git", "-c", "core.autocrlf=false", ...args], {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr.toString()}`);
  return proc.stdout.toString().trim();
}

const BOARD_ID = "PVT_board1";
const OPTIONS = [
  { id: "o1", name: "Todo" },
  { id: "o2", name: "In Progress" },
  { id: "o3", name: "In Review" },
  { id: "o4", name: "Done" },
];

interface BoardItem {
  id: string;
  number: number;
  status: string;
  updatedAt: string;
}

/** What GitHub answers to each call, for the items as they are now. */
function rules(items: BoardItem[], scopes: string[]) {
  const node = (item: BoardItem) => ({
    id: item.id,
    isArchived: false,
    updatedAt: item.updatedAt,
    fieldValueByName: { name: item.status },
    content: {
      __typename: "Issue",
      number: item.number,
      title: `Item ${item.number}`,
      body: `Body ${item.number}`,
      url: `https://github.com/acme/app/issues/${item.number}`,
      repository: { nameWithOwner: "acme/app" },
      author: { login: "octocat" },
      authorAssociation: "OWNER",
    },
  });
  const data = (value: unknown) => ({ stdout: JSON.stringify({ data: value }) });
  const quoted = scopes.map((s) => "'" + s + "'").join(", ");
  return [
    {
      args: ["auth", "status"],
      stdout: `github.com\n  ✓ Logged in to github.com account octocat (keyring)\n  - Token scopes: ${quoted}\n`,
    },
    {
      args: ["api", "graphql"],
      contains: ["updateProjectV2ItemFieldValue"],
      ...data({
        updateProjectV2ItemFieldValue: { projectV2Item: { updatedAt: new Date().toISOString() } },
      }),
    },
    {
      args: ["api", "graphql"],
      contains: ["field(name", `board=${BOARD_ID}`],
      ...data({ node: { field: { id: "PVTSSF_status", options: OPTIONS } } }),
    },
    {
      args: ["api", "graphql"],
      contains: ["items(first", `board=${BOARD_ID}`],
      ...data({
        viewer: { login: "octocat" },
        node: {
          items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: items.map(node) },
        },
      }),
    },
    {
      args: ["api", "graphql"],
      contains: ["projectsV2(first"],
      ...data({
        viewer: {
          login: "octocat",
          projectsV2: {
            nodes: [
              {
                id: BOARD_ID,
                title: "Roadmap",
                number: 3,
                url: "https://github.com/users/octocat/projects/3",
                owner: { login: "octocat" },
              },
            ],
          },
          organizations: { nodes: [] },
        },
      }),
    },
  ];
}

interface Card {
  id: string;
  title: string;
  column: string;
}

async function run(work: string): Promise<void> {
  const projects = join(work, "projects");
  const repo = join(projects, "app");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "# app\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "first");

  const items: BoardItem[] = [
    { id: "PVTI_1", number: 1, status: "Todo", updatedAt: "2026-10-01T10:00:00Z" },
    { id: "PVTI_2", number: 2, status: "In Progress", updatedAt: "2026-10-01T10:00:00Z" },
  ];
  const gh = installFakeCli("gh", rules(items, ["repo", "read:project"]));
  const mutations = () =>
    gh.calls().filter((call) => call.some((arg) => arg.includes("updateProjectV2ItemFieldValue")));

  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-boardsync",
      port: 0,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [projects],
      runtime: "fake",
      history: { roots: [join(work, "sem-historico")] },
    }),
  );

  step = "subir daemon";
  const daemon = Bun.spawn(
    [
      process.execPath,
      "run",
      join(ROOT, "apps/daemon/src/bin.ts"),
      "start",
      "--config",
      configPath,
      "--runtime",
      "fake",
    ],
    { env: process.env, stdout: "pipe", stderr: "inherit" },
  );
  try {
    const url = await readListenUrl(daemon.stdout);
    log(`daemon em ${url}`);
    const client = new Client(url);
    await client.open(token);
    const cards = async (projectId: string): Promise<Card[]> =>
      (
        await client.call<{
          columns: Array<{ column: string; cards: Array<{ id: string; title: string }> }>;
        }>("board.get", { projectId })
      ).columns.flatMap((entry) => entry.cards.map((card) => ({ ...card, column: entry.column })));

    step = "o host anuncia boardsync";
    const info = await client.call<{ features: string[] }>("host.info", {});
    if (!info.features.includes("boardsync")) throw new Error("o host devia anunciar boardsync");
    const boards = await client.call<{ boards: Array<{ id: string; title: string }> }>(
      "boardsync.boards",
      {},
    );
    if (boards.boards[0]?.id !== BOARD_ID) throw new Error("faltou o quadro Roadmap");
    log("o quadro Roadmap veio da lista");

    step = "ligar o quadro";
    const project = await client.call<{ id: string }>("project.add", { path: repo });
    const linked = await client.call<{ linked: boolean; push: boolean; statusOptions: string[] }>(
      "boardsync.link",
      { projectId: project.id, boardId: BOARD_ID },
    );
    if (!linked.linked || linked.push || linked.statusOptions.length !== 4) {
      throw new Error(`ligação inesperada: ${JSON.stringify(linked)}`);
    }
    const first = await cards(project.id);
    const columnOf = (title: string, list: Card[]) => list.find((c) => c.title === title)?.column;
    if (
      first.length !== 2 ||
      columnOf("Item 1", first) !== "backlog" ||
      columnOf("Item 2", first) !== "in_progress"
    ) {
      throw new Error(`os itens deviam virar cards nas colunas do mapa: ${JSON.stringify(first)}`);
    }
    log("os 2 itens viraram cards: Todo no Backlog, In Progress em Em andamento");

    step = "sem envio com o push desligado";
    const card1 = first.find((c) => c.title === "Item 1") as Card;
    await client.call("card.move", { cardId: card1.id, column: "review" });
    await client.call("boardsync.syncNow", { projectId: project.id });
    if (mutations().length !== 0) throw new Error("nada devia ser enviado com o push desligado");
    log("mover um card aqui não mudou nada no quadro");

    step = "ligar o push pede confirmação e a permissão";
    const noConfirm = await client.fail("boardsync.setPush", {
      projectId: project.id,
      push: true,
      confirm: false,
    });
    if (!noConfirm.includes("board_sync_confirm"))
      throw new Error(`devia pedir confirmação: ${noConfirm}`);
    const noScope = await client.fail("boardsync.setPush", {
      projectId: project.id,
      push: true,
      confirm: true,
    });
    if (!noScope.includes("board_sync_scope_missing")) {
      throw new Error(`devia recusar sem a permissão project: ${noScope}`);
    }
    gh.respond(rules(items, ["repo", "read:project", "project"]));
    const on = await client.call<{ push: boolean }>("boardsync.setPush", {
      projectId: project.id,
      push: true,
      confirm: true,
    });
    if (!on.push) throw new Error("o push devia ficar ligado");
    log("o push recusou sem confirmar e sem a permissão project, e ligou com as duas");

    step = "o movimento chega ao quadro";
    await client.call("card.move", { cardId: card1.id, column: "done" });
    const sent = await client.call<{ report: { pushed: number } }>("boardsync.syncNow", {
      projectId: project.id,
    });
    const sentCalls = mutations();
    if (
      sent.report.pushed !== 1 ||
      sentCalls.length !== 1 ||
      !sentCalls[0]?.includes("option=o4")
    ) {
      throw new Error(`devia enviar Done (o4) uma vez: ${JSON.stringify(sentCalls)}`);
    }
    log("o card movido para Concluído mandou a opção Done ao quadro, uma vez");

    step = "a mudança mais nova do quadro vence";
    const card2 = first.find((c) => c.title === "Item 2") as Card;
    await client.call("card.move", { cardId: card2.id, column: "review" });
    items[1] = { id: "PVTI_2", number: 2, status: "Done", updatedAt: "2099-01-01T00:00:00Z" };
    gh.respond(rules(items, ["repo", "read:project", "project"]));
    const conflict = await client.call<{ report: { conflicts: number } }>("boardsync.syncNow", {
      projectId: project.id,
    });
    const after = await cards(project.id);
    if (conflict.report.conflicts !== 1 || columnOf("Item 2", after) !== "done") {
      throw new Error(`o quadro devia vencer: ${JSON.stringify({ conflict, after })}`);
    }
    const log2 = await client.call<{
      entries: Array<{ kind: string; winner: string; lostValue: string; keptValue: string }>;
    }>("boardsync.log", { cardId: card2.id });
    const entry = log2.entries[0];
    if (
      entry?.kind !== "conflict" ||
      entry.winner !== "external" ||
      entry.lostValue !== "review" ||
      entry.keptValue !== "Done"
    ) {
      throw new Error(`o registro devia guardar o que perdeu: ${JSON.stringify(log2)}`);
    }
    log("a mudança mais nova do quadro venceu e o que perdeu (review) está no registro do card");

    step = "desligar mantém os cards";
    await client.call("boardsync.unlink", { projectId: project.id });
    const status = await client.call<{ linked: boolean }>("boardsync.status", {
      projectId: project.id,
    });
    if (status.linked || (await cards(project.id)).length !== 2) {
      throw new Error("desligar devia manter os dois cards");
    }
    log("desligar manteve os cards");
    client.close();
  } finally {
    daemon.kill();
    await daemon.exited;
    gh.restore();
  }
}

const work = realTempDir("flightdeck-smoke-boardsync-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  assertNoRefusedChecks(checks);
  console.log("SMOKE BOARDSYNC OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE BOARDSYNC FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
