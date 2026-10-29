import {
  type Ack,
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
class DaemonClient {
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

  static async connect(url: string, token: string): Promise<DaemonClient> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("sem resposta")), { once: true });
    });
    const client = new DaemonClient(ws);
    await client.call("hello", { token, client: "flightdeck-mcp" });
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

/**
 * `flightdeckd mcp`: an MCP server for the Claude Code of this host. It talks to the local
 * daemon with the token of its config and lets a session list projects and workflows, create
 * and start cards and follow them. Approving permissions and answering gates stay with you, in
 * the app: there is no tool for either.
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

  const { promise: closed, resolve } = Promise.withResolvers<void>();
  server.server.onclose = () => {
    daemon.close();
    resolve();
  };
  await server.connect(opts.transport);
  return { closed };
}
