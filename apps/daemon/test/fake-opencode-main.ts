/**
 * Phase 39: the fake `opencode` (see fake-opencode.ts). It answers what Flightdeck runs: `--version`,
 * `models --standalone`, the three `api GET ... --standalone` routes, and `acp`, a small ACP peer
 * whose prompt `run: <command>` asks to run a shell command first. Each run is logged as one JSON
 * line (its arguments and the OpenCode variables it got) to the file in FAKE_OPENCODE_LOG, and
 * each ACP request (its method, and a prompt's text) to the file in FAKE_OPENCODE_ACP_LOG.
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { linesOf } from "../src/lines.ts";

const args = process.argv.slice(2);
const log = process.env.FAKE_OPENCODE_LOG;
if (log) {
  appendFileSync(
    log,
    `${JSON.stringify({
      args,
      cwd: process.cwd(),
      disableProjectConfig: process.env.OPENCODE_DISABLE_PROJECT_CONFIG ?? null,
      hasConfigContent: Boolean(process.env.OPENCODE_CONFIG_CONTENT),
      session: process.env.FLIGHTDECK_SESSION ?? null,
    })}\n`,
  );
}

const MODELS = ["anthropic/claude-sonnet-5-5", "opencode/crouton-alpha-free"];

function globalDir(): string {
  const env = process.env;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "opencode");
  const home =
    process.platform === "win32" ? env.USERPROFILE || env.HOME : env.HOME || env.USERPROFILE;
  return join(home ?? "", ".config", "opencode");
}

/** Our agents as OpenCode would resolve them: their own rules, then OpenCode's two denies. */
function agents(): unknown {
  const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "{}") as {
    agents?: Record<string, { mode?: string; disabled?: boolean; permissions?: unknown[] }>;
  };
  const suffix = [
    { action: "browser", resource: "*", effect: "deny" },
    { action: "skill", resource: "browser", effect: "deny" },
  ];
  const ours = Object.entries(config.agents ?? {})
    .filter(([, agent]) => !agent.disabled)
    .map(([id, agent]) => ({
      id,
      hidden: false,
      permissions: [...(agent.permissions ?? []), ...suffix],
    }));
  return { data: [...ours, { id: "compaction", hidden: true, permissions: [] }] };
}

/**
 * What booting a private server costs: FAKE_OPENCODE_BOOT_MS of busy CPU before an `api --standalone`
 * answers or a `serve` listens (the real one measured 8 to 15 s on a busy Raspberry Pi 5).
 */
function boot(): void {
  const until = Date.now() + Number(process.env.FAKE_OPENCODE_BOOT_MS ?? 0);
  while (Date.now() < until) {
    // busy on purpose: the cost is CPU, not waiting
  }
}

/** What a route answers, as the `api` command prints it and `serve` sends it; null for an unknown one. */
function body(route: string): unknown {
  if (route === "/api/config") {
    return [
      { type: "directory", path: globalDir() },
      { type: "document", info: {} },
    ];
  }
  if (route === "/api/agent") return agents();
  if (route === "/api/permission/saved") return { data: [] };
  return null;
}

/**
 * `serve`: the private server a preflight starts once. Prints the line the real one prints, wants
 * the password of OPENCODE_SERVER_PASSWORD (Basic, user `opencode`) and answers the three routes.
 * FAKE_OPENCODE_SERVE bends it: `exit` (dies at once), `hang` (never listens), `silent` (listens,
 * never answers a route), `http500`, `notjson`.
 */
async function serve(): Promise<void> {
  boot();
  const mode = process.env.FAKE_OPENCODE_SERVE ?? "";
  if (mode === "exit") process.exit(3);
  if (mode === "hang") {
    setInterval(() => {}, 1000);
    return;
  }
  const password = process.env.OPENCODE_SERVER_PASSWORD ?? "";
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const route = new URL(request.url).pathname;
      const authorized =
        password !== "" &&
        request.headers.get("authorization") === `Basic ${btoa(`opencode:${password}`)}`;
      if (log) appendFileSync(log, `${JSON.stringify({ args: ["GET", route], authorized })}\n`);
      if (!authorized) return new Response("unauthorized", { status: 401 });
      if (mode === "silent") return new Promise<Response>(() => {});
      if (mode === "http500") return new Response("boom", { status: 500 });
      if (mode === "notjson") return new Response("secret-looking text");
      const found = body(route);
      return found === null ? new Response("no", { status: 404 }) : Response.json(found);
    },
  });
  console.log(`opencode server listening on http://127.0.0.1:${server.port}`);
  process.on("SIGTERM", () => process.exit(0));
}

function answer(): void {
  const [first, , route] = args;
  if (first === "api") boot();
  if (first === "--version") console.log("opencode v2.2.5");
  else if (first === "models") console.log(MODELS.join("\n"));
  else if (first === "api" && route === "/api/config") {
    console.log(
      JSON.stringify([
        { type: "directory", path: globalDir() },
        { type: "document", info: {} },
      ]),
    );
  } else if (first === "api" && route === "/api/agent") console.log(JSON.stringify(agents()));
  else if (first === "api" && route === "/api/permission/saved")
    console.log(JSON.stringify({ data: [] }));
  else process.exit(2);
}

async function acp(): Promise<void> {
  const write = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const state = { model: MODELS[1] as string, mode: "flightdeck", cost: 0 };
  const options = () => [
    {
      id: "model",
      currentValue: state.model,
      options: MODELS.map((value) => ({ value, name: value })),
    },
    {
      id: "effort",
      currentValue: "default",
      options: ["low", "high", "default"].map((value) => ({ value, name: value })),
    },
    {
      id: "mode",
      currentValue: state.mode,
      options: ["flightdeck", "flightdeck-plan"].map((value) => ({ value, name: value })),
    },
  ];
  const update = (sessionId: string, body: Record<string, unknown>) =>
    write({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: body } });
  let nextId = 1000;
  const asked = new Map<number, (result: { outcome?: { optionId?: string } }) => void>();
  let prompt: { id: number; sessionId: string } | null = null;
  const endPrompt = (stopReason: string) => {
    if (!prompt) return;
    state.cost += 0.01;
    update(prompt.sessionId, {
      sessionUpdate: "usage_update",
      used: 100,
      size: 1000,
      cost: { amount: state.cost, currency: "USD" },
    });
    write({
      jsonrpc: "2.0",
      id: prompt.id,
      result: { stopReason, usage: { inputTokens: 10, outputTokens: 5 } },
    });
    prompt = null;
  };

  const turn = async (id: number, sessionId: string, text: string) => {
    prompt = { id, sessionId };
    const command = /run: (.+)$/.exec(text)?.[1];
    if (command) {
      const toolCallId = `call_${id}`;
      update(sessionId, {
        sessionUpdate: "tool_call",
        toolCallId,
        name: "shell",
        status: "pending",
        rawInput: {},
      });
      update(sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "in_progress",
        rawInput: { command, cwd: process.cwd() },
      });
      const permissionId = nextId++;
      const reply = new Promise<{ outcome?: { optionId?: string } }>((resolve) =>
        asked.set(permissionId, resolve),
      );
      write({
        jsonrpc: "2.0",
        id: permissionId,
        method: "session/request_permission",
        params: {
          sessionId,
          toolCall: { toolCallId, name: "shell", rawInput: { command, cwd: process.cwd() } },
          options: [
            { optionId: "once", kind: "allow_once", name: "Allow once" },
            { optionId: "always", kind: "allow_always", name: "Always allow" },
            { optionId: "reject", kind: "reject_once", name: "Reject" },
          ],
        },
      });
      const { outcome } = await reply;
      if (prompt?.id !== id) return;
      if (outcome?.optionId !== "once") {
        update(sessionId, {
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "failed",
          content: [
            {
              type: "content",
              content: { type: "text", text: "The user declined this tool call" },
            },
          ],
        });
        endPrompt("cancelled");
        return;
      }
      update(sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: `ran ${command}` } }],
      });
    }
    if (text.includes("wait")) return; // stays open until a cancel
    update(sessionId, {
      sessionUpdate: "agent_message_chunk",
      messageId: `msg_${id}`,
      content: { type: "text", text: "done" },
    });
    endPrompt("end_turn");
  };

  for await (const line of linesOf(Bun.stdin.stream())) {
    if (!line.trim()) continue;
    const message = JSON.parse(line) as {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      result?: unknown;
    };
    if (message.method === undefined && typeof message.id === "number") {
      asked.get(message.id)?.(message.result as { outcome?: { optionId?: string } });
      asked.delete(message.id);
      continue;
    }
    const params = message.params ?? {};
    const acpLog = process.env.FAKE_OPENCODE_ACP_LOG;
    if (acpLog && message.method) {
      const blocks = (params.prompt as Array<{ type: string; text?: string }> | undefined) ?? [];
      const text = blocks.find((b) => b.type === "text")?.text;
      appendFileSync(
        acpLog,
        `${JSON.stringify({ method: message.method, ...(text === undefined ? {} : { text }) })}\n`,
      );
    }
    const sessionId = String(params.sessionId ?? "ses_fake");
    switch (message.method) {
      case "initialize":
        write({
          jsonrpc: "2.0",
          id: message.id,
          result: { protocolVersion: 1, agentCapabilities: { loadSession: true } },
        });
        break;
      case "session/new":
        write({
          jsonrpc: "2.0",
          id: message.id,
          result: { sessionId: "ses_fake", configOptions: options() },
        });
        break;
      case "session/resume":
        write({ jsonrpc: "2.0", id: message.id, result: { configOptions: options() } });
        break;
      case "session/set_config_option":
        if (params.configId === "model") state.model = String(params.value);
        if (params.configId === "mode") state.mode = String(params.value);
        write({ jsonrpc: "2.0", id: message.id, result: { configOptions: options() } });
        break;
      case "session/prompt": {
        const blocks = (params.prompt as Array<{ type: string; text?: string }>) ?? [];
        void turn(
          message.id as number,
          sessionId,
          blocks.find((b) => b.type === "text")?.text ?? "",
        );
        break;
      }
      case "session/cancel":
        for (const [id, resolve] of asked) {
          resolve({ outcome: { optionId: "reject" } });
          asked.delete(id);
        }
        endPrompt("cancelled");
        break;
      case "session/close":
        write({ jsonrpc: "2.0", id: message.id, result: {} });
        break;
      default:
        if (message.id !== undefined)
          write({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: "method not found" },
          });
    }
  }
}

if (args[0] === "acp") await acp();
else if (args[0] === "serve") await serve();
else answer();
