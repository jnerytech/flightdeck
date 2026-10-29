import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ExternalPermissions } from "../src/central/external-permissions.ts";
import { UsageIndexer } from "../src/costs/usage-indexer.ts";
import {
  type AutoApproveRequest,
  AutoApprover,
  type AutoApproveSettings,
  autoApproveDir,
  historyExcludes,
} from "../src/permissions/auto-approve.ts";
import { RiskClassifier, type RiskLevel } from "../src/permissions/risk.ts";
import { ClaudeSdkRuntime, type QueryHandle } from "../src/runtime/claude-sdk-runtime.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import type { JudgeOptions, JudgeResult } from "../src/runtime/types.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newBoard } from "./board-helpers.ts";
import { newManager, poll, record, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "auto-token-0123456789abcdef";
const ON: AutoApproveSettings = { enabled: true, model: "claude-haiku-5-5", lowWithoutAi: true };
const TOKENS = {
  model: "claude-haiku-5-5",
  speed: "standard",
  input: 300,
  output: 20,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
};

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** The hook's answer as JSON; null when it left the decision to the terminal (""). */
const answer = (body: string) => (body ? JSON.parse(body) : null);

/** An approver over a project at `cwd`, with a fake AI answering `judge`. */
function setup(
  opts: {
    settings?: AutoApproveSettings;
    judge?: (o: JudgeOptions) => JudgeResult | Promise<JudgeResult>;
    timeoutMs?: number;
  } = {},
) {
  const cwd = tempDir("fd-auto-");
  const store = new EventStore(":memory:");
  cleanups.push(() => store.close());
  const runtime = new FakeRuntime({
    judge: opts.judge ?? (() => ({ decision: "allow", reason: "claramente seguro" })),
  });
  const dataDir = tempDir("fd-data-");
  const usage = new UsageIndexer({
    db: store.db,
    roots: [],
    projectKey: () => "github.com/acme/app",
  });
  const auto = new AutoApprover({
    db: store.db,
    runtime,
    dataDir,
    context: (dir) =>
      dir === cwd
        ? { projectId: "p1", settings: opts.settings ?? ON, description: "corrigir o login" }
        : null,
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    usage,
  });
  const request = (
    toolName: string,
    input: Record<string, unknown>,
    level: RiskLevel,
    network = false,
    sessionKey = "s1",
  ): AutoApproveRequest => ({
    sessionKey,
    requestId: `r-${toolName}`,
    toolName,
    input,
    cwd,
    risk: { level, reason: "regra", network },
  });
  return { cwd, store, runtime, dataDir, auto, request };
}

describe("auto-aprovacao", () => {
  test("desligada ou fora de um projeto: não decide nem consulta a IA", async () => {
    const off = setup({ settings: { ...ON, enabled: false } });
    expect(await off.auto.decide(off.request("Write", { file_path: "a" }, "medium"))).toBeNull();
    const outside = setup();
    expect(
      await outside.auto.decide({
        ...outside.request("Write", { file_path: "a" }, "medium"),
        cwd: tempDir(),
      }),
    ).toBeNull();
    expect([...off.runtime.judgeCalls, ...outside.runtime.judgeCalls]).toEqual([]);
  });

  test("high nunca é automático, nem com a IA dizendo allow; rede também nunca", async () => {
    const { auto, request, runtime } = setup();
    expect(await auto.decide(request("Bash", { command: "rm -rf build" }, "high"))).toMatchObject({
      decision: "ask",
      by: "rule",
    });
    expect(
      await auto.decide(request("WebFetch", { url: "https://x.example" }, "medium", true)),
    ).toMatchObject({ decision: "ask", by: "rule" });
    expect(runtime.judgeCalls).toEqual([]);
  });

  test("low aprova sem IA com lowWithoutAi; sem a opção, low passa pela IA", async () => {
    const withRule = setup();
    expect(await withRule.auto.decide(withRule.request("Read", { file_path: "a" }, "low"))).toEqual(
      { decision: "allow", reason: expect.any(String), by: "rule", model: null },
    );
    expect(withRule.runtime.judgeCalls).toEqual([]);
    const withAi = setup({ settings: { ...ON, lowWithoutAi: false } });
    expect(
      await withAi.auto.decide(withAi.request("Read", { file_path: "a" }, "low")),
    ).toMatchObject({ decision: "allow", by: "ai", model: "claude-haiku-5-5" });
    expect(withAi.runtime.judgeCalls).toHaveLength(1);
  });

  test("medium pela IA: allow aprova; ask, erro e timeout vão para você; a IA nunca nega", async () => {
    const answers: Record<string, () => JudgeResult | Promise<JudgeResult>> = {
      Write: () => ({ decision: "allow", reason: "dentro do pedido" }),
      Edit: () => ({ decision: "ask", reason: "na dúvida" }),
      Bash: () => ({ decision: "deny", reason: "perigoso" }),
      NotebookEdit: () => {
        throw new Error("modelo fora do ar");
      },
      Task: () => new Promise(() => {}),
    };
    const { auto, request } = setup({
      judge: (o) => (answers[/ferramenta: (\w+)/.exec(o.prompt)?.[1] ?? ""] as () => JudgeResult)(),
      timeoutMs: 200,
    });
    const decide = (tool: string) => auto.decide(request(tool, { file_path: "a" }, "medium"));
    expect(await decide("Write")).toMatchObject({ decision: "allow", by: "ai" });
    expect(await decide("Edit")).toMatchObject({ decision: "ask", by: "ai" });
    // A "no" from the AI becomes a question for you, never a denial.
    expect(await decide("Bash")).toMatchObject({ decision: "ask", by: "ai" });
    expect(await decide("NotebookEdit")).toMatchObject({
      decision: "ask",
      reason: expect.stringContaining("modelo fora do ar"),
    });
    expect(await decide("Task")).toMatchObject({
      decision: "ask",
      reason: expect.stringContaining("0.2 s"),
    });
  });

  test("a pergunta: modelo, cwd próprio, ferramenta, entrada cortada, descrição do card e a política", async () => {
    const { auto, request, runtime, dataDir, cwd } = setup();
    await auto.decide(
      request("Write", { file_path: "a.txt", content: "x".repeat(5000) }, "medium"),
    );
    const [call] = runtime.judgeCalls;
    expect(call?.model).toBe("claude-haiku-5-5");
    expect(call?.cwd).toBe(autoApproveDir(dataDir));
    expect(autoApproveDir(dataDir)).toBe(join(dataDir, "auto-approve"));
    expect(call?.prompt).toContain("ferramenta: Write");
    expect(call?.prompt).toContain(cwd);
    expect(call?.prompt).toContain("corrigir o login");
    expect(call?.prompt).toContain("na dúvida");
    expect(call?.prompt.length).toBeLessThan(3000);
  });

  test("consulta pelo SDK isolada: sem settings, sem sessão gravada, sem ferramentas, um turno e saída estruturada", async () => {
    const seen: Options[] = [];
    const result = {
      type: "result",
      subtype: "success",
      structured_output: { decision: "allow", reason: "ok" },
      usage: {
        input_tokens: 300,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      modelUsage: {},
    } as unknown as SDKMessage;
    const runtime = new ClaudeSdkRuntime({
      query: ({ options }) => {
        seen.push(options);
        return {
          async *[Symbol.asyncIterator]() {
            yield result;
          },
          interrupt: async () => {},
          close: () => {},
        } as QueryHandle;
      },
    });
    const dir = tempDir();
    const judged = await runtime.judgePermission({
      model: "claude-haiku-5-5",
      prompt: "p",
      cwd: dir,
    });
    expect(judged).toEqual({
      decision: "allow",
      reason: "ok",
      tokens: { ...TOKENS },
    });
    expect(seen[0]).toMatchObject({
      model: "claude-haiku-5-5",
      cwd: dir,
      maxTurns: 1,
      settingSources: [],
      persistSession: false,
      tools: [],
      env: expect.objectContaining({ FLIGHTDECK_MANAGED: "1" }),
      outputFormat: { type: "json_schema" },
    });
    // No structured answer (or an odd one) is a question for you.
    const odd = new ClaudeSdkRuntime({
      query: () =>
        ({
          async *[Symbol.asyncIterator]() {
            yield {
              type: "result",
              subtype: "error_max_turns",
              usage: result,
            } as unknown as SDKMessage;
          },
          interrupt: async () => {},
          close: () => {},
        }) as QueryHandle,
    });
    expect(await odd.judgePermission({ model: "m", prompt: "p", cwd: dir })).toMatchObject({
      decision: "ask",
    });
  });

  test("o cwd da consulta fica fora do histórico", () => {
    expect(
      historyExcludes({ dataDir: "/d", history: { excludeCwds: ["/x"] } }).map((p) =>
        p.replaceAll("\\", "/"),
      ),
    ).toEqual(["/x", "/d/auto-approve"]);
  });

  test("suspensa numa sessão (conteúdo de terceiro): medium vai para você até reativar; sobrevive ao reinício", async () => {
    const { auto, request, store, runtime, dataDir } = setup();
    auto.suspend("s1", "conteúdo de terceiro no card");
    expect(await auto.decide(request("Write", { file_path: "a" }, "medium"))).toMatchObject({
      decision: "ask",
      reason: expect.stringContaining("suspensa"),
    });
    expect(
      await auto.decide(request("Write", { file_path: "a" }, "medium", false, "s2")),
    ).toMatchObject({ decision: "allow" });
    const again = new AutoApprover({ db: store.db, runtime, dataDir, context: () => null });
    expect(again.suspended()).toMatchObject([
      { sessionKey: "s1", reason: "conteúdo de terceiro no card" },
    ]);
    auto.resume("s1");
    expect(await auto.decide(request("Write", { file_path: "a" }, "medium"))).toMatchObject({
      decision: "allow",
    });
    expect(auto.suspended()).toEqual([]);
  });

  test("registro: cada decisão em auto_approvals, com filtros; a consulta entra no uso com origem auto-approve", async () => {
    const { auto, request, store } = setup({
      judge: () => ({ decision: "allow", reason: "seguro", tokens: TOKENS }),
    });
    await auto.decide(request("Read", { file_path: "a" }, "low"));
    await auto.decide(request("Write", { file_path: "a" }, "medium", false, "s2"));
    await auto.decide(request("Bash", { command: "rm -rf x" }, "high"));
    expect(auto.list().map((r) => [r.toolName, r.risk, r.decision, r.by])).toEqual([
      ["Bash", "high", "ask", "rule"],
      ["Write", "medium", "allow", "ai"],
      ["Read", "low", "allow", "rule"],
    ]);
    expect(auto.list({ sessionKey: "s2" }).map((r) => r.toolName)).toEqual(["Write"]);
    expect(auto.list({ projectId: "outro" })).toEqual([]);
    expect(auto.list({ limit: 1 })).toHaveLength(1);
    expect(
      store.db.query("SELECT origin, model, input, output, project_key FROM usage_entries").all(),
    ).toEqual([
      {
        origin: "auto-approve",
        model: "claude-haiku-5-5",
        input: 300,
        output: 20,
        project_key: "github.com/acme/app",
      },
    ]);
  });

  test("sessão gerenciada: medium aprovado pela IA resolve sozinho, com o motivo no evento", async () => {
    const runtime = new FakeRuntime({
      delayMs: 1,
      judge: () => ({ decision: "allow", reason: "teste dentro do pedido" }),
    });
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    const auto = new AutoApprover({
      db: store.db,
      runtime,
      dataDir: tempDir(),
      context: () => ({ projectId: "p1", settings: ON }),
    });
    const { manager, project } = newManager({ runtime, store, autoApprove: auto });
    const { sessionId } = manager.create({ cwd: project, prompt: "[bash]" });
    const events = record(manager, sessionId);
    cleanups.push(() => events.unsubscribe());
    const resolved = await poll(() => events.find("permission.resolved")[0], 3000);
    expect(resolved).toMatchObject({
      decision: "allow",
      auto: { by: "ai", reason: "teste dentro do pedido", model: "claude-haiku-5-5" },
    });
    expect(await poll(() => events.find("tool.result")[0], 3000)).toBeDefined();
    // The turn ends before the store closes: a run still streaming would write to a closed one.
    expect(await poll(() => manager.get(sessionId).status === "idle", 3000)).toBe(true);
  });

  test("sessão do terminal: low aprovado mesmo sem app olhando; high fica com o terminal", async () => {
    const { auto, cwd } = setup();
    const permissions = new ExternalPermissions({
      risk: new RiskClassifier({ allowedRoots: [], home: tempDir() }),
      auto,
    });
    const hold = (toolName: string, input: Record<string, unknown>) =>
      permissions.hold(
        { session_id: "t1", cwd, tool_name: toolName, tool_input: input },
        new AbortController().signal,
      );
    expect(answer(await hold("Read", { file_path: "a.ts" }))).toEqual({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
    });
    expect(await hold("Bash", { command: "rm -rf build" })).toBe("");
  });

  test("sessão do terminal com app olhando: o frame fecha como aprovado automaticamente", async () => {
    const { auto, cwd } = setup();
    const permissions = new ExternalPermissions({
      risk: new RiskClassifier({ allowedRoots: [], home: tempDir() }),
      auto,
    });
    const frames: Array<Record<string, unknown>> = [];
    cleanups.push(permissions.watch((frame) => frames.push(frame)));
    // Without the automatic answer the hook stays held: a second is plenty for the fake AI.
    const body = await Promise.race([
      permissions.hold(
        { session_id: "t1", cwd, tool_name: "Write", tool_input: { file_path: "a.ts" } },
        new AbortController().signal,
      ),
      Bun.sleep(1000).then(() => ""),
    ]);
    expect(answer(body)?.hookSpecificOutput.decision.behavior).toBe("allow");
    expect(frames.at(-1)).toMatchObject({
      state: "closed",
      resolution: "allow",
      auto: { by: "ai", reason: "claramente seguro" },
    });
  });

  test("protocolo: a config do projeto, autoapprove.list e autoapprove.resume", async () => {
    const { board, manager, repo } = newBoard();
    const project = await board.addProject({ path: repo });
    expect(project.autoApprove).toEqual({
      enabled: false,
      model: "claude-haiku-5-5",
      lowWithoutAi: true,
    });
    const { auto } = setup();
    auto.suspend("s9", "conteúdo de terceiro");
    const server = startServer({
      manager,
      board,
      autoApprove: auto,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const updated = await client.data<{ autoApprove: AutoApproveSettings }>("project.update", {
      projectId: project.id,
      autoApprove: { enabled: true },
    });
    expect(updated?.autoApprove).toEqual({ ...ON });
    expect(board.getProject(project.id).autoApprove.enabled).toBe(true);
    const listed = await client.data<{ suspended: Array<{ sessionKey: string }> }>(
      "autoapprove.list",
      {},
    );
    expect(listed?.suspended.map((s) => s.sessionKey)).toEqual(["s9"]);
    expect(await client.request("autoapprove.resume", { sessionKey: "s9" })).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
    await client.data("autoapprove.resume", { sessionKey: "s9", confirm: true });
    expect(auto.suspended()).toEqual([]);
  });
});
