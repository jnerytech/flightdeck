import {
  type Ack,
  type ActionInfo,
  type CommandPayload,
  type CommandResults,
  type CommandType,
  parseServerMessage,
  WS_PATH,
} from "@flightdeck/protocol";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";

export interface McpOptions {
  /** Protocol URL of the local daemon (`ws://…/v1/ws`). */
  url: string;
  /** The daemon's token, from its config. */
  token: string;
  /** Where Claude Code speaks MCP to us: stdio for real, in memory in tests. */
  transport: Transport;
  /** The folder Claude Code runs in: the project whose snippets are listed when none is named. */
  cwd?: string;
}

export interface McpHandle {
  /** Resolves when the client closes the server. */
  closed: Promise<void>;
}

/** Where the MCP server finds the daemon of this host. */
export function daemonUrl(config: { bind: string; port: number }): string {
  const any = config.bind === "0.0.0.0" || config.bind === "::";
  const host = any ? "127.0.0.1" : config.bind;
  return `ws://${host.includes(":") ? `[${host}]` : host}:${config.port}${WS_PATH}`;
}

/** The daemon protocol, as any client of the app speaks it: `hello`, then commands and acks. */
export class DaemonClient {
  private readonly acks = new Map<string, { ok(ack: Ack): void; fail(error: Error): void }>();
  private seq = 0;

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (msg) => {
      const frame = parseServerMessage(String(msg.data));
      if (frame.type === "ping") ws.send(JSON.stringify({ type: "pong", id: frame.id }));
      if (frame.type === "ack") this.acks.get(frame.id)?.ok(frame);
    });
    ws.addEventListener("close", () => {
      for (const pending of this.acks.values()) pending.fail(new Error("conexão encerrada"));
      this.acks.clear();
    });
  }

  static async connect(url: string, token: string, name = "flightdeck-mcp"): Promise<DaemonClient> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("sem resposta")), { once: true });
    });
    const client = new DaemonClient(ws);
    await client.call("hello", { token, client: name });
    return client;
  }

  call<T extends CommandType>(type: T, payload: CommandPayload<T>): Promise<CommandResults[T]> {
    const id = String(++this.seq);
    return new Promise((resolve, reject) => {
      this.acks.set(id, {
        ok: (ack) => {
          this.acks.delete(id);
          if (ack.ok) resolve(ack.data as CommandResults[T]);
          else reject(new Error(`${ack.error.code}: ${ack.error.message}`));
        },
        fail: reject,
      });
      this.ws.send(JSON.stringify({ id, type, payload }));
    });
  }

  close(): void {
    this.ws.close();
  }
}

/** What Claude may know of the actions it can run: never the command, the env or a secret. */
export function runnableActions(actions: ActionInfo[]) {
  return actions
    .filter((action) => action.trusted)
    .map(({ name, description, approval, params }) => ({ name, description, approval, params }));
}

/**
 * `flightdeckd mcp`: an MCP server for the Claude Code of this host. It talks to the local
 * daemon with the token of its config and lets a session list projects and workflows, create
 * and start cards and follow them, and run the declared actions that use a secret without seeing
 * it. Approving permissions, answering gates and handing a secret over stay with you, in the app:
 * there is no tool for any of them.
 */
export async function startMcp(opts: McpOptions): Promise<McpHandle> {
  const daemon = await DaemonClient.connect(opts.url, opts.token).catch((error: Error) => {
    throw new Error(`não consegui conectar no daemon em ${opts.url}: ${error.message}`);
  });
  const server = new McpServer({ name: "flightdeck", version: "1.0.0" });
  const tool = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    inputSchema: S,
    run: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
  ) =>
    server.registerTool(name, { description, inputSchema }, (async (
      args: z.infer<z.ZodObject<S>>,
    ) => {
      try {
        return { content: [{ type: "text", text: JSON.stringify(await run(args), null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: (error as Error).message }] };
      }
    }) as never);

  tool("list_projects", "Projetos (repositórios) cadastrados neste host.", {}, () =>
    daemon.call("project.list", {}),
  );
  tool(
    "list_workflows",
    "Workflows de um projeto, lidos da branch base, com validação, confiança e inputs.",
    { projectId: z.string() },
    ({ projectId }) => daemon.call("workflow.list", { projectId }),
  );
  tool(
    "create_card",
    "Cria um card no Backlog do projeto.",
    { projectId: z.string(), title: z.string().min(1), description: z.string().optional() },
    ({ projectId, title, description }) =>
      daemon.call("card.create", { projectId, title, description: description ?? "" }),
  );
  tool(
    "start_card",
    "Inicia um card; com `workflow`, roda esse workflow confiado com os `inputs`.",
    {
      cardId: z.string(),
      workflow: z.string().min(1).optional(),
      inputs: z.record(z.string(), z.string()).optional(),
    },
    ({ cardId, workflow, inputs }) =>
      daemon.call("card.start", {
        cardId,
        ...(workflow ? { workflow } : {}),
        ...(inputs ? { inputs } : {}),
      }),
  );
  tool("get_card", "Estado de um card.", { cardId: z.string() }, ({ cardId }) =>
    daemon.call("card.get", { cardId }),
  );
  tool(
    "get_run",
    "Execução de um workflow: etapas, uso e orçamento.",
    { runId: z.string() },
    ({ runId }) => daemon.call("run.get", { runId }),
  );

  // Phase 17: use a secret without ever receiving it. The value stays between the app and the
  // daemon; what comes back is the exit code and the output, with the secret masked.
  tool(
    "list_actions",
    "Ações que você pode rodar com run_action: nome, descrição e parâmetros (padrão e valor default). Nunca mostra segredos.",
    { projectId: z.string().optional() },
    async ({ projectId }) => {
      const { actions } = await daemon.call("actions.list", projectId ? { projectId } : {});
      return { actions: runnableActions(actions) };
    },
  );
  tool(
    "run_action",
    "Roda uma ação declarada, pelo nome, com os parâmetros que ela permite. O Flightdeck aplica os segredos do lado dele (pode pedir a aprovação do usuário no app) e devolve o código de saída e a saída, até 32 KB, com os segredos mascarados.",
    {
      name: z.string().min(1),
      params: z.record(z.string(), z.string()).optional(),
      projectId: z.string().optional(),
    },
    ({ name, params, projectId }) =>
      daemon.call("actions.run", {
        name,
        requestedBy: "claude",
        ...(params ? { params } : {}),
        ...(projectId ? { projectId } : {}),
      }),
  );
  tool(
    "run_with_secret",
    "Roda um comando seu com segredos do cofre no ambiente (deploy-token vira DEPLOY_TOKEN). Sempre pede a aprovação do usuário no app, com o comando, os nomes dos segredos e o host; nunca é automático. A saída volta com os segredos mascarados, mas só valores literais, em base64, em URL e em hex: prefira uma ação declarada.",
    {
      command: z.string().min(1).max(4000),
      secrets: z.array(z.string().min(1)).min(1).max(8),
      host: z.string().optional(),
    },
    ({ command, secrets, host }) =>
      daemon.call("actions.runFree", {
        command,
        secrets,
        requestedBy: "claude",
        ...(host ? { host } : {}),
      }),
  );
  // Snippets are only read here: nothing the Flightdeck runs, pastes or counts for Claude.
  /** With a named project, as asked; without, the folder Claude runs in, or only the host's when the daemon does not allow it. */
  const inProject = async <T>(
    projectPath: string | undefined,
    ask: (path: string | undefined) => Promise<T>,
  ): Promise<T> => {
    if (projectPath !== undefined) return ask(projectPath);
    try {
      return await ask(opts.cwd);
    } catch (error) {
      if (!(error as Error).message.startsWith("forbidden_cwd")) throw error;
      return ask(undefined);
    }
  };
  tool(
    "list_snippets",
    "Snippets (comandos e prompts salvos) do host e do projeto, com o texto, as variáveis e se um comando do arquivo do projeto pode rodar.",
    {
      projectPath: z.string().optional(),
      query: z.string().optional(),
      tag: z.string().optional(),
      type: z.enum(["command", "prompt"]).optional(),
    },
    ({ projectPath, query, tag, type }) =>
      inProject(projectPath, (path) =>
        daemon.call("snippets.list", {
          ...(path ? { projectPath: path } : {}),
          ...(query ? { query } : {}),
          ...(tag ? { tag } : {}),
          ...(type ? { type } : {}),
        }),
      ),
  );
  tool(
    "get_snippet",
    "O texto de um snippet pelo nome, para usar como referência. Não o executa: rodar um comando passa pelas permissões do Claude Code.",
    { name: z.string().min(1), projectPath: z.string().optional() },
    ({ name, projectPath }) =>
      inProject(projectPath, (path) =>
        daemon.call("snippets.get", { name, ...(path ? { projectPath: path } : {}) }),
      ),
  );

  const { promise: closed, resolve } = Promise.withResolvers<void>();
  server.server.onclose = () => {
    daemon.close();
    resolve();
  };
  await server.connect(opts.transport);
  return { closed };
}
