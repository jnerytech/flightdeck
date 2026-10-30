import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runCli } from "../src/main.ts";
import { daemonUrl } from "../src/mcp.ts";
import { startServer } from "../src/server.ts";
import { poll, tempDir } from "./helpers.ts";
import { workflowCard } from "./workflow-helpers.ts";

// Real git in temp repositories and a whole workflow run: more than the default 5 s.
setDefaultTimeout(20_000);

const TOKEN = "mcp-token-0123456789abcdef0123";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const YAML =
  "inputs: [task]\nsteps:\n  - id: plan\n    agent: { prompt: 'plano de {{inputs.task}}' }\n";

/** A daemon (in process) with a trusted workflow, and `flightdeckd mcp` pointed at it. */
async function setup(options: { token?: string; port?: number } = {}) {
  const ctx = await workflowCard(YAML);
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
  const file = join(tempDir(), "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      token: options.token ?? TOKEN,
      port: options.port ?? server.port,
      dataDir: join(tempDir(), "data"),
    }),
  );
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const exits: number[] = [];
  const errors: string[] = [];
  await runCli(["mcp", "--config", file], {
    env: {},
    log: { log: () => {}, error: (m) => errors.push(m) },
    exit: (code) => exits.push(code),
    onSignal: () => {},
    mcpTransport: serverSide,
  });
  const client = new Client({ name: "teste", version: "1.0.0" });
  /** Calls a tool: the JSON it answered, or the error text. */
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    try {
      const result = await client.callTool({ name, arguments: args });
      const text = (result.content as Array<{ text?: string }>)[0]?.text ?? "";
      return result.isError ? { error: text } : { data: JSON.parse(text) };
    } catch (error) {
      return { error: (error as Error).message };
    }
  };
  return { ...ctx, server, client, clientSide, exits, errors, call };
}

async function connected(options: Parameters<typeof setup>[0] = {}) {
  const ctx = await setup(options);
  const ok = await Promise.race([
    ctx.client.connect(ctx.clientSide).then(() => true),
    Bun.sleep(3000).then(() => false),
  ]);
  cleanups.push(() => ctx.client.close());
  return { ...ctx, ok };
}

describe("mcp", () => {
  test("expõe exatamente as onze ferramentas: nenhuma de permissão nem de gate, e dos snippets só ler", async () => {
    const { client, ok } = await connected();
    expect(ok).toBe(true);
    const names = await client.listTools().then(
      (listed) => listed.tools.map((t) => t.name).sort(),
      () => [],
    );
    expect(names).toEqual([
      "create_card",
      "get_card",
      "get_run",
      "get_snippet",
      "list_actions",
      "list_projects",
      "list_snippets",
      "list_workflows",
      "run_action",
      "run_with_secret",
      "start_card",
    ]);
    expect(names.some((n) => /permission|gate|approve|respond/.test(n))).toBe(false);
  });

  test("cada ferramenta responde pelo cliente MCP em processo", async () => {
    const { call, project, board } = await connected();
    const projects = await call("list_projects");
    expect(projects.data?.projects?.map((p: { id: string }) => p.id)).toEqual([project.id]);
    const workflows = await call("list_workflows", { projectId: project.id });
    expect(workflows.data?.workflows).toEqual([
      expect.objectContaining({ name: "wf", trusted: true, inputs: ["task"] }),
    ]);
    const created = await call("create_card", {
      projectId: project.id,
      title: "Pelo MCP",
      description: "criado por uma sessão",
    });
    expect(created.data).toMatchObject({ title: "Pelo MCP", column: "backlog" });
    const cardId = created.data?.id ?? "";
    expect(board.getCard(cardId).description).toBe("criado por uma sessão");
    const started = await call("start_card", { cardId, workflow: "wf", inputs: { task: "somar" } });
    const runId = started.data?.workflowRunId ?? "";
    expect(runId).not.toBe("");
    const run = await poll(() => {
      const current = runId ? board.workflows.getRun(runId) : null;
      return current?.status === "completed" ? current : null;
    }, 5000);
    expect(run?.status).toBe("completed");
    const fetched = await call("get_run", { runId });
    expect(fetched.data).toMatchObject({ id: runId, status: "completed" });
    expect(fetched.data?.steps?.[0]?.output).toBe("Echo: plano de somar");
    expect((await call("get_card", { cardId })).data).toMatchObject({
      id: cardId,
      workflowRunId: runId,
    });
    const simple = await call("create_card", { projectId: project.id, title: "Simples" });
    expect(simple.data?.description).toBe("");
    expect((await call("start_card", { cardId: simple.data?.id })).data?.workflowRunId).toBeNull();
  });

  test("erro do daemon volta como erro da ferramenta", async () => {
    const { call } = await connected();
    expect(await call("get_run", { runId: "nada" })).toEqual({
      error: "not_found: execução nada não existe",
    });
  });

  test("fechar o cliente encerra o comando com código 0", async () => {
    const { client, exits } = await connected();
    await client.close();
    expect(await poll(() => exits.includes(0), 2000)).toBe(true);
  });

  test("sem daemon ou com token errado, sai com 1 e diz por quê", async () => {
    const closed = await setup({ port: 1 });
    expect(closed.exits).toEqual([1]);
    expect(closed.errors[0] ?? "").toContain("não consegui conectar no daemon");
    const refused = await setup({ token: "outro-token-0123456789abcdef" });
    expect(refused.exits).toEqual([1]);
    expect(refused.errors[0] ?? "").toContain("não consegui conectar no daemon");
  });

  test("endereço do daemon a partir da config", () => {
    expect(daemonUrl({ bind: "127.0.0.1", port: 7420 })).toBe("ws://127.0.0.1:7420/v1/ws");
    expect(daemonUrl({ bind: "0.0.0.0", port: 7420 })).toBe("ws://127.0.0.1:7420/v1/ws");
    expect(daemonUrl({ bind: "::", port: 7000 })).toBe("ws://127.0.0.1:7000/v1/ws");
    expect(daemonUrl({ bind: "100.64.0.2", port: 7420 })).toBe("ws://100.64.0.2:7420/v1/ws");
    expect(daemonUrl({ bind: "fd00::1", port: 7420 })).toBe("ws://[fd00::1]:7420/v1/ws");
  });
});
