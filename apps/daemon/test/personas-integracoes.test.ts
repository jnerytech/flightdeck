import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Board } from "../src/board/board.ts";
import { ExternalSessions } from "../src/central/external.ts";
import { sendSessionStart } from "../src/central/hook-command.ts";
import { Costs } from "../src/costs/costs.ts";
import { DEFAULT_PRICING } from "../src/costs/pricing.ts";
import { runCli } from "../src/main.ts";
import { packPersonas } from "../src/personas/pack.ts";
import { Personas } from "../src/personas/store.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import { startServer } from "../src/server.ts";
import { SessionManager } from "../src/sessions/session-manager.ts";
import { SecretScanner } from "../src/snippets/model.ts";
import { EventStore } from "../src/store/event-store.ts";
import { parseWorkflow } from "../src/workflows/schema.ts";
import { cardWhen, gitRepo } from "./board-helpers.ts";
import { installFakeClaude } from "./fake-claude.ts";
import { newManager, poll, tempDir, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { commitWorkflow, sha256 } from "./workflow-helpers.ts";

// Real git in temp repositories and several turns per test: more than the default 5 s.
setDefaultTimeout(30_000);

const TOKEN = "personas-int-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const scanner = new SecretScanner();

/** A board over a git repo whose sessions know the personas of the pack. */
function setup() {
  const { root, repo } = gitRepo();
  const store = new EventStore(":memory:");
  const personas = new Personas({
    db: store.db,
    allowedRoots: [root],
    scanner,
    pack: packPersonas,
  });
  const runtime = new FakeRuntime({ delayMs: 1 });
  const manager = new SessionManager({
    store,
    runtime,
    allowedRoots: [root],
    defaultPermissionMode: "default",
    allowApiKey: false,
    baseEnv: {},
    personas,
  });
  const board = new Board({ db: store.db, manager, allowedRoots: [root] });
  cleanups.push(() => board.stop());
  cleanups.push(() => manager.shutdown());
  return { root, repo, store, personas, runtime, manager, board };
}

describe("personas-integracoes: etapa de workflow", () => {
  const REVIEW = [
    "steps:",
    "  - id: revisar",
    "    parallel:",
    "      - agent: { persona: seguranca, prompt: Revise a segurança }",
    "      - agent: { persona: revisor, prompt: Revise o código }",
    "",
  ].join("\n");

  test("a etapa agent aceita persona: o id é simples e ela não vale com continue", () => {
    const ok = parseWorkflow("steps:\n  - id: a\n    agent: { persona: seguranca, prompt: x }\n");
    expect(ok.errors).toEqual([]);
    expect(ok.workflow?.steps[0]).toMatchObject({ agent: { persona: "seguranca" } });
    expect(parseWorkflow(REVIEW).errors).toEqual([]);
    const invalid = parseWorkflow("steps:\n  - id: a\n    agent: { persona: '../x', prompt: x }\n");
    expect(invalid.errors.join("\n")).toMatch(/persona/);
    const withContinue = parseWorkflow(
      [
        "steps:",
        "  - id: a",
        "    agent: { prompt: x }",
        "  - id: b",
        "    agent: { persona: qa, continue: a, prompt: y }",
        "",
      ].join("\n"),
    );
    expect(withContinue.errors.join("\n")).toMatch(/persona.*continue|continue.*persona/);
  });

  test("a revisão em paralelo da spec: cada etapa abre a sessão na sua persona", async () => {
    const { board, repo, manager, runtime } = setup();
    commitWorkflow(repo, "wf", REVIEW);
    const project = await board.addProject({ path: repo, promptTemplate: "" });
    await board.trustWorkflow(project.id, "wf", sha256(REVIEW));
    const card = board.createCard(project.id, { title: "Revisar", description: "rev" });
    await board.startCard(card.id, { workflow: "wf" });
    const done = await poll(() => {
      const id = board.getCard(card.id).workflowRunId;
      const run = id ? board.workflows.getRun(id) : null;
      return run?.status === "completed" ? run : null;
    }, 15_000);
    expect(done).not.toBeNull();
    const sessions = (done?.steps ?? [])
      .filter((step) => step.sessionId)
      .map((step) => manager.get(step.sessionId ?? ""));
    expect(sessions.map((s) => s.persona?.id).sort()).toEqual(["revisor", "seguranca"]);
    const bySecurity = runtime.starts.find((s) =>
      s.persona?.append.includes("revisor de segurança"),
    );
    expect(bySecurity).toMatchObject({
      model: "claude-opus-5-5",
      permissionMode: "plan",
      persona: { effort: "high", tools: ["Read", "Grep", "Glob", "Bash"] },
    });
    const byReviewer = runtime.starts.find((s) => s.persona?.append.includes("revisor de código"));
    expect(byReviewer?.persona?.tools).toEqual(["Read", "Grep", "Glob", "Bash"]);
  });

  test("uma persona que não vale derruba a etapa com o motivo, sem abrir sessão", async () => {
    const { board, repo, manager } = setup();
    const yaml = "steps:\n  - id: a\n    agent: { persona: nao-existe, prompt: oi }\n";
    commitWorkflow(repo, "wf", yaml);
    const project = await board.addProject({ path: repo, promptTemplate: "" });
    await board.trustWorkflow(project.id, "wf", sha256(yaml));
    const card = board.createCard(project.id, { title: "X", description: "x" });
    await board.startCard(card.id, { workflow: "wf" });
    const failed = await poll(() => {
      const id = board.getCard(card.id).workflowRunId;
      const run = id ? board.workflows.getRun(id) : null;
      return run?.status === "failed" ? run : null;
    }, 15_000);
    expect(failed?.steps.map((s) => s.status)).toEqual(["failed"]);
    expect(String(failed?.statusReason)).toMatch(/persona/i);
    expect(manager.list()).toEqual([]);
  });
});

describe("personas-integracoes: no board", () => {
  async function started() {
    const ctx = setup();
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const card = ctx.board.createCard(project.id, { title: "Tarefa", description: "faça" });
    return { ...ctx, project, card };
  }

  test("iniciar o card com persona abre a sessão nela", async () => {
    const { board, card, manager, runtime } = await started();
    await board.startCard(card.id, { persona: { id: "qa" } });
    const running = await cardWhen(board, card.id, (c) => c.sessionId !== null);
    expect(manager.get(running?.sessionId ?? "").persona).toMatchObject({ id: "qa" });
    expect(runtime.starts[0]?.persona?.append).toMatch(/engenheiro de QA sênior/);
  });

  test("a persona padrão da coluna vale quando o card recomeça, e a pedida na hora vence", async () => {
    const { board, card, project, manager, runtime } = await started();
    const updated = board.updateProject(project.id, { personaByColumn: { review: "revisor" } });
    expect(updated.personaByColumn).toEqual({ review: "revisor" });
    // From the backlog there is no default: a plain session.
    await board.startCard(card.id);
    const first = await cardWhen(
      board,
      card.id,
      (c) => c.sessionId !== null && c.column === "review",
    );
    expect(manager.get(first?.sessionId ?? "").persona).toBeUndefined();
    // Now in review: starting again opens the reviewer.
    await board.startCard(card.id);
    const second = await cardWhen(
      board,
      card.id,
      (c) => c.sessionId !== null && c.sessionId !== first?.sessionId && c.column === "review",
    );
    expect(manager.get(second?.sessionId ?? "").persona).toMatchObject({ id: "revisor" });
    expect(runtime.starts.at(-1)?.persona?.append).toMatch(/revisor de código sênior/);
    // What was asked for in the start wins over the column's default.
    await board.startCard(card.id, { persona: { id: "docs" } });
    const third = await cardWhen(
      board,
      card.id,
      (c) => c.sessionId !== null && c.sessionId !== second?.sessionId && c.column === "review",
    );
    expect(manager.get(third?.sessionId ?? "").persona).toMatchObject({ id: "docs" });
  });

  test("os padrões por coluna: ids simples, só colunas que existem, null tira o padrão", async () => {
    const { board, project } = await started();
    const bad = (patch: Record<string, string | null>) => {
      try {
        board.updateProject(project.id, { personaByColumn: patch as never });
        return "ok";
      } catch (error) {
        return (error as { code?: string }).code ?? "sem código";
      }
    };
    expect(bad({ review: "../x" })).toBe("bad_request");
    expect(bad({ nao_existe: "qa" })).toBe("bad_request");
    expect(bad({ review: "revisor", backlog: "arquiteto" })).toBe("ok");
    expect(board.getProject(project.id).personaByColumn).toEqual({
      review: "revisor",
      backlog: "arquiteto",
    });
    expect(bad({ review: null })).toBe("ok");
    expect(board.getProject(project.id).personaByColumn).toEqual({ backlog: "arquiteto" });
  });

  test("um padrão que não vale (a persona foi apagada, ou perdeu a confiança) falha a execução com o motivo, e o card espera", async () => {
    const { board, card, project, manager } = await started();
    board.updateProject(project.id, { personaByColumn: { backlog: "persona-que-sumiu" } });
    await board.startCard(card.id);
    const waiting = await cardWhen(board, card.id, (c) => c.column === "waiting");
    expect(waiting?.notice ?? "").toMatch(/persona/i);
    expect(manager.list()).toEqual([]);
  });
});

describe("personas-integracoes: na central", () => {
  test("o hook SessionStart leva a persona com que o terminal abriu, e a sessão mostra o selo", async () => {
    const badge = { id: "qa", name: "QA / testes", icon: "flask" };
    const bodies: unknown[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        bodies.push(await req.json());
        return new Response("");
      },
    });
    cleanups.push(() => server.stop(true));
    await sendSessionStart({
      url: `http://127.0.0.1:${server.port}`,
      token: "t",
      input: JSON.stringify({ session_id: "claude-9" }),
      env: { FLIGHTDECK_LAUNCH_ID: "L9", FLIGHTDECK_PERSONA: JSON.stringify(badge) },
      timeoutMs: 2000,
    });
    expect(bodies[0]).toMatchObject({ session_id: "claude-9", launch_id: "L9", persona: badge });
    // Junk in the variable is not forwarded.
    await sendSessionStart({
      url: `http://127.0.0.1:${server.port}`,
      token: "t",
      input: JSON.stringify({ session_id: "claude-10" }),
      env: { FLIGHTDECK_PERSONA: "isto não é json" },
      timeoutMs: 2000,
    });
    expect(bodies[1]).not.toHaveProperty("persona");

    const external = new ExternalSessions({ db: new EventStore(":memory:").db, staleAfterS: 900 });
    external.apply("SessionStart", bodies[0] as Record<string, unknown>);
    expect(external.get("claude-9")?.persona).toEqual(badge);
    // Applied on top, and back to the one it opened with after leaving.
    external.setPersona("claude-9", { id: "seg", name: "Segurança", icon: null });
    expect(external.get("claude-9")?.persona).toMatchObject({ id: "seg" });
    external.setPersona("claude-9", null);
    expect(external.get("claude-9")?.persona).toEqual(badge);
    // A badge that is not one is ignored.
    external.apply("SessionStart", { session_id: "claude-11", persona: { id: 3 } });
    expect(external.get("claude-11")?.persona).toBeUndefined();
  });

  test("flightdeckd claude --persona avisa o claude: FLIGHTDECK_PERSONA leva o selo da persona", async () => {
    const { root, project } = workspace();
    const personas = new Personas({
      db: new EventStore(":memory:").db,
      allowedRoots: [root],
      scanner,
      pack: packPersonas,
    });
    const dir = tempDir();
    const dataDir = join(dir, "data");
    mkdirSync(dataDir, { recursive: true });
    const server = startServer({
      manager: newManager().manager,
      personas,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: "t".repeat(32),
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        token: "t".repeat(32),
        port: server.port,
        dataDir,
        hooks: { port: 0, token: "hooks-token-0123456789" },
      }),
    );
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    await runCli(["claude", "--persona", "qa"], {
      env: { ...process.env, FLIGHTDECK_CONFIG: file },
      log: { log: () => {}, error: () => {} },
      exit: () => {},
      onSignal: () => {},
      selfCommand: [process.execPath, "run", join(import.meta.dir, "..", "src", "bin.ts")],
      cwd: project,
    });
    const start = fake.events().find((e) => e.type === "start") as unknown as {
      env: Record<string, string>;
    };
    expect(JSON.parse(start.env.FLIGHTDECK_PERSONA ?? "null")).toEqual({
      id: "qa",
      name: "QA / testes",
      icon: "flask",
    });
  });

  test("as listas de sessões trazem o selo, para a central filtrar por persona", async () => {
    const { root, project, store, personas } = (() => {
      const w = workspace();
      const s = new EventStore(":memory:");
      return {
        ...w,
        store: s,
        personas: new Personas({ db: s.db, allowedRoots: [w.root], scanner, pack: packPersonas }),
      };
    })();
    const { manager } = newManager({ store, allowedRoots: [root], personas });
    cleanups.push(() => manager.shutdown());
    manager.create({ cwd: project, prompt: "oi", persona: { id: "dba" } });
    manager.create({ cwd: project, prompt: "oi" });
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const listed = await client.data<{ sessions: Array<{ persona?: { id: string } }> }>(
      "session.list",
      {},
    );
    expect(listed?.sessions.map((s) => s.persona?.id ?? "-").sort()).toEqual(["-", "dba"]);
  });
});

describe("personas-integracoes: custo por persona", () => {
  test("costs.summary quebra o gasto por persona: a da abertura, a aplicada depois, a da sessão de terminal e a sem persona", () => {
    const { root, project } = workspace();
    const store = new EventStore(":memory:");
    const personas = new Personas({
      db: store.db,
      allowedRoots: [root],
      scanner,
      pack: packPersonas,
    });
    const { manager } = newManager({ store, allowedRoots: [root], personas });
    cleanups.push(() => manager.shutdown());
    const link = (persona: { id: string } | undefined, claude: string) => {
      const { sessionId } = manager.create({
        cwd: project,
        prompt: "oi",
        ...(persona ? { persona } : {}),
      });
      store.updateSession(sessionId, { claudeSessionId: claude });
      return sessionId;
    };
    link({ id: "qa" }, "c-qa");
    link({ id: "qa" }, "c-qa-2");
    link(undefined, "c-plain");
    const applied = link(undefined, "c-applied");
    manager.markPersona(applied, { id: "docs", name: "Tech writer", icon: "book" });
    const external = new ExternalSessions({ db: store.db, staleAfterS: 900 });
    external.apply("SessionStart", {
      session_id: "c-term",
      persona: { id: "seguranca", name: "Seg", icon: null },
    });
    external.apply("SessionStart", { session_id: "c-term-2" });
    external.setPersona("c-term-2", { id: "sre", name: "SRE", icon: null });
    const insert = (id: string, session: string, cost: number) =>
      store.db
        .query(
          `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
             speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
           VALUES (?, ?, '2026-10-01T12:00:00.000Z', '2026-10-01', 'k', 'claude-opus-5-5', 'app',
             'standard', 10, 0, 0, 0, 0, ?)`,
        )
        .run(id, session, cost);
    insert("m1", "c-qa", 1);
    insert("m2", "c-qa-2", 2);
    insert("m3", "c-plain", 4);
    insert("m4", "c-applied", 8);
    insert("m5", "c-term", 16);
    insert("m6", "c-term-2", 32);
    insert("m7", "sem-dono", 64);
    const costs = new Costs({ db: store.db, pricing: DEFAULT_PRICING });
    const summary = costs.summary({ from: "2026-10-01", to: "2026-10-01" });
    expect(summary.byPersona).toEqual([
      { persona: null, costUsd: 68, tokens: 20 },
      { persona: "sre", costUsd: 32, tokens: 10 },
      { persona: "seguranca", costUsd: 16, tokens: 10 },
      { persona: "docs", costUsd: 8, tokens: 10 },
      { persona: "qa", costUsd: 3, tokens: 20 },
    ]);
    // The total is the same: the persona is a way to cut it, not an extra.
    expect(summary.totals.costUsd).toBe(127);
  });
});

describe("personas-integracoes: arena", () => {
  test("each variant of an arena opens in its own persona, and the comparison says which", async () => {
    const { board, repo, manager } = setup();
    const project = await board.addProject({ path: repo, promptTemplate: "" });
    const card = board.createCard(project.id, { title: "Tarefa", description: "faça" });
    const arena = await board.startArena(card.id, {
      variants: [{ persona: { id: "seguranca" } }, { persona: { id: "qa" } }, {}],
    });
    const sessions = await Promise.all(
      arena.variants.map((v) => cardWhen(board, v.id, (c) => c.sessionId !== null)),
    );
    expect(sessions.map((c) => manager.get(c?.sessionId ?? "").persona?.id ?? null)).toEqual([
      "seguranca",
      "qa",
      null,
    ]);
    expect((await board.arena(card.id)).variants.map((v) => v.persona)).toEqual([
      "seguranca",
      "qa",
      null,
    ]);
  });
});
