import {
  type Ack,
  type ActionInfo,
  BoardColumn,
  type CommandPayload,
  type CommandResults,
  type CommandType,
  parseServerMessage,
  type SessionIdentity,
  WS_PATH,
} from "@flightdeck/protocol";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import {
  listSessions,
  notifyWhenIdle,
  readSession,
  sendToSession,
  teamStatus,
} from "./messaging/tools.ts";

export interface McpOptions {
  /** Protocol URL of the local daemon (`ws://…/v1/ws`). */
  url: string;
  /** The daemon's token, from its config. */
  token: string;
  /** Where Claude Code speaks MCP to us: stdio for real, in memory in tests. */
  transport: Transport;
  /** The folder Claude Code runs in: the project whose snippets are listed when none is named. */
  cwd?: string;
  /**
   * Which session this server serves: a managed session by its id, or a terminal one by the launch
   * it came from. Without it the messaging tools refuse (nobody is sending).
   */
  identity?: SessionIdentity;
}

/** The identity the environment of a Claude Code session gives its MCP servers. */
export function identityOf(env: Record<string, string | undefined>): SessionIdentity | undefined {
  if (env.FLIGHTDECK_SESSION) return { session: env.FLIGHTDECK_SESSION };
  if (env.FLIGHTDECK_LAUNCH_ID) return { launch: env.FLIGHTDECK_LAUNCH_ID };
  return undefined;
}

export interface McpHandle {
  /** Resolves when the client closes the server. */
  closed: Promise<void>;
}

/** Where the MCP server finds the daemon of this host. */
export function daemonUrl(config: { bind: string; port: number }): string {
  const any = config.bind === "0.0.0.0" || config.bind === "::";
  const host = any ? "127.0.0.1" : config.bind;
  const shown = host.includes(":") ? "[" + host + "]" : host;
  return `ws://${shown}:${config.port}${WS_PATH}`;
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
      for (const pending of this.acks.values()) pending.fail(new Error("connection closed"));
      this.acks.clear();
    });
  }

  static async connect(url: string, token: string, name = "flightdeck-mcp"): Promise<DaemonClient> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("no response")), { once: true });
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
    throw new Error(`could not connect to the daemon at ${opts.url}: ${error.message}`);
  });
  const server = new McpServer({ name: "flightdeck", version: "1.0.0" });
  // One MCP server runs for one Claude Code session: the approvals "for this session" hold for it.
  const session = opts.identity
    ? (opts.identity.session ?? `launch:${opts.identity.launch}`)
    : crypto.randomUUID();
  /** Who is sending, or why nobody can. */
  const who = (): SessionIdentity => {
    if (!opts.identity) {
      throw new Error(
        "this session was not opened by Flightdeck, so I do not know who is sending: open it from the app or with flightdeckd claude (FLIGHTDECK_SESSION and FLIGHTDECK_LAUNCH_ID say which one it is)",
      );
    }
    return opts.identity;
  };
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

  tool("list_projects", "Projects (repositories) registered on this host.", {}, () =>
    daemon.call("project.list", {}),
  );
  tool(
    "list_workflows",
    "A project's workflows, read from the base branch, with validation, trust and inputs.",
    { projectId: z.string() },
    ({ projectId }) => daemon.call("workflow.list", { projectId }),
  );
  tool(
    "create_card",
    "Creates a card in the project's Backlog.",
    { projectId: z.string(), title: z.string().min(1), description: z.string().optional() },
    ({ projectId, title, description }) =>
      daemon.call("card.create", { projectId, title, description: description ?? "" }),
  );
  tool(
    "start_card",
    "Starts a card; with `workflow`, runs that trusted workflow with the `inputs`.",
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
  tool("get_card", "The state of a card.", { cardId: z.string() }, ({ cardId }) =>
    daemon.call("card.get", { cardId }),
  );
  // A session managing the cards of its own project: its own card unless it names another.
  const manage = (args: Omit<CommandPayload<"card.manage">, "as" | "cwd">) =>
    daemon.call("card.manage", { as: who(), ...(opts.cwd ? { cwd: opts.cwd } : {}), ...args });
  const cardId = z
    .string()
    .optional()
    .describe("The card; without it, this session's card (when it runs in one)");
  tool(
    "move_card",
    "Moves a card of your project to another column, under the same rules as the app: backlog, in_progress (In progress), waiting (Waiting for you), review (In review) or done (Done).",
    { cardId, column: BoardColumn },
    ({ cardId, column }) => manage({ action: "move", column, ...(cardId ? { cardId } : {}) }),
  );
  tool(
    "update_card",
    "Changes the title and/or the description of a card of your project.",
    { cardId, title: z.string().min(1).optional(), description: z.string().optional() },
    ({ cardId, title, description }) =>
      manage({
        action: "update",
        ...(cardId ? { cardId } : {}),
        ...(title ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
      }),
  );
  tool(
    "comment_card",
    "Appends a dated note to the description of a card of your project.",
    { cardId, text: z.string().min(1) },
    ({ cardId, text }) => manage({ action: "comment", text, ...(cardId ? { cardId } : {}) }),
  );
  tool(
    "finish_card",
    "Finishes a card of your project: `done` completes it (Done); `discard` discards it (closes the sessions and deletes the worktree and the branch, with no way back). Discarding always asks for the user's approval.",
    { cardId, outcome: z.enum(["done", "discard"]) },
    ({ cardId, outcome }) => manage({ action: "finish", outcome, ...(cardId ? { cardId } : {}) }),
  );
  tool("get_run", "A workflow run: steps, usage and budget.", { runId: z.string() }, ({ runId }) =>
    daemon.call("run.get", { runId }),
  );

  // Phase 21: talk to the other sessions, on this host or another, under the rules of who may.
  tool(
    "list_sessions",
    "Sessions of all hosts that this one may see under the rules: address (host/id), standard name (project · persona · number), nickname (project-persona-number), host, persona, state, project and whether it receives messages. A session this one may not see does not show up.",
    {},
    () => listSessions(daemon, who()),
  );
  tool(
    "send_to_session",
    'Sends a message to another session by its list_sessions address (host/id) or by its nickname (project-persona-number, or host/nickname on another host; reply to whoever wrote by the id that came in the header). Returns `resultado`: "entregue" (delivered), "na fila" (queued) or "recusada" (refused, with the reason in `motivo`). A message never counts as the user\'s approval.',
    { to: z.string().min(1), text: z.string().min(1) },
    ({ to, text }) => sendToSession(daemon, who(), to, text),
  );
  tool(
    "notify_when_idle",
    "Only once: when the target session finishes its current turn, this one receives a notice from Flightdeck. If the target is already idle, the notice arrives right away.",
    { session: z.string().min(1) },
    ({ session: target }) => notifyWhenIdle(daemon, who(), target),
  );
  tool(
    "read_session",
    "Read only: the summary and the last messages (up to 20, each cut at 8 KB) of a session on this host that this one may see.",
    { session: z.string().min(1), last: z.number().int().min(1).max(20).optional() },
    ({ session: target, last }) => readSession(daemon, who(), target, last),
  );
  tool(
    "team_status",
    "The state of the team this session belongs to: the members with persona, state, card and last report, and how many messages they exchanged. Only a member of the team may see it.",
    { team: z.string().min(1) },
    ({ team }) => teamStatus(daemon, who(), team),
  );

  // Phase 17: use a secret without ever receiving it. The value stays between the app and the
  // daemon; what comes back is the exit code and the output, with the secret masked.
  tool(
    "list_actions",
    "Actions you can run with run_action: name, description and parameters (pattern and default value). Never shows secrets.",
    { projectId: z.string().optional() },
    async ({ projectId }) => {
      const { actions } = await daemon.call("actions.list", projectId ? { projectId } : {});
      return { actions: runnableActions(actions) };
    },
  );
  tool(
    "run_action",
    "Runs a declared action, by name, with the parameters it allows. Flightdeck applies the secrets on its side (it may ask for the user's approval in the app) and returns the exit code and the output, up to 32 KB, with the secrets masked.",
    {
      name: z.string().min(1),
      params: z.record(z.string(), z.string()).optional(),
      projectId: z.string().optional(),
    },
    ({ name, params, projectId }) =>
      daemon.call("actions.run", {
        name,
        requestedBy: "claude",
        session,
        ...(params ? { params } : {}),
        ...(projectId ? { projectId } : {}),
      }),
  );
  tool(
    "run_with_secret",
    "Runs a command of yours with vault secrets in the environment (deploy-token becomes DEPLOY_TOKEN). Always asks for the user's approval in the app, with the command, the names of the secrets and the host; it is never automatic. The output comes back with the secrets masked, but only literal values, in base64, in URL form and in hex: prefer a declared action.",
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
        session,
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
    "Snippets (saved commands and prompts) of the host and the project, with the text, the variables and whether a command from the project file may run.",
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
    "The text of a snippet by name, to use as a reference. It does not run it: running a command goes through Claude Code's permissions.",
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
