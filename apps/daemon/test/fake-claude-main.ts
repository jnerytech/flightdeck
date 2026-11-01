// Body of the fake `claude` (see fake-claude.ts): `bun fake-claude-main.ts <stateDir> ...args`.
// Records its arguments and environment, then plays the hand-written script in
// <stateDir>/script.json the way Claude Code would: command hooks through the shell, http hooks
// with the installed headers, the transcript under ~/.claude/projects and the MCP server from
// --mcp-config, whose channel notifications it logs.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { FakeClaudeStep } from "./fake-claude.ts";
import { runHookCommand } from "./hook-shell.ts";

const [stateDir = "", ...args] = process.argv.slice(2);
const log = (entry: Record<string, unknown>) =>
  appendFileSync(join(stateDir, "events.jsonl"), `${JSON.stringify(entry)}\n`);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      key.startsWith("FLIGHTDECK_") ||
      key.startsWith("OTEL_") ||
      key === "CLAUDE_CODE_ENABLE_TELEMETRY",
  ),
);
const mcpConfigFile = args[args.indexOf("--mcp-config") + 1];
const mcpConfig =
  args.includes("--mcp-config") && mcpConfigFile && existsSync(mcpConfigFile)
    ? JSON.parse(readFileSync(mcpConfigFile, "utf8"))
    : null;
// The system prompt a persona appends travels in a file that only lives while claude runs.
const appendedPath = args[args.indexOf("--append-system-prompt-file") + 1] ?? null;
const appended =
  args.includes("--append-system-prompt-file") && appendedPath && existsSync(appendedPath)
    ? readFileSync(appendedPath, "utf8")
    : null;
// The subagents the wrapper hands over travel in a file too (nine bodies do not fit on a Windows command line).
const agentsPath = args[args.indexOf("--agents") + 1] ?? null;
const agents =
  args.includes("--agents") && agentsPath && existsSync(agentsPath)
    ? JSON.parse(readFileSync(agentsPath, "utf8"))
    : null;
// Claude Code's own subcommands for background sessions (`claude agents --json`, `stop`...): the
// fake records the call and answers from <stateDir>/agents.json; <stateDir>/fail makes them fail.
if (["agents", "stop", "kill", "respawn", "attach", "logs", "rm"].includes(args[0] ?? "")) {
  log({ type: "cli", args });
  if (existsSync(join(stateDir, "fail"))) {
    console.error("no such session");
    process.exit(1);
  }
  const listed = join(stateDir, "agents.json");
  if (args[0] === "agents")
    process.stdout.write(existsSync(listed) ? readFileSync(listed, "utf8") : "[]");
  else console.log("ok");
  process.exit(0);
}
log({
  type: "start",
  args,
  env,
  mcpConfig,
  appended,
  appendedPath: appended === null ? null : appendedPath,
  agents,
  agentsPath: agents === null ? null : agentsPath,
});

interface HookEntry {
  type: "command" | "http";
  command?: string;
  url?: string;
  headers?: Record<string, string>;
}
type Settings = { hooks?: Record<string, Array<{ hooks: HookEntry[] }>> };

const settingsFile = join(homedir(), ".claude", "settings.json");
const settings = (): Settings =>
  existsSync(settingsFile) ? (JSON.parse(readFileSync(settingsFile, "utf8")) as Settings) : {};
const hooksFor = (event: string) => (settings().hooks?.[event] ?? []).flatMap((g) => g.hooks);

const cwd = process.cwd();
let sessionId = "";
let transcript = "";
const base = () => ({ session_id: sessionId, transcript_path: transcript, cwd });

/** Command hooks go through Claude Code's own shell (Git Bash on Windows, sh elsewhere). */
async function runCommand(command: string, input: string): Promise<void> {
  const { code, stdout, stderr } = await runHookCommand(command, input);
  log({ type: "command", command, code, stdout, stderr });
}

async function postHook(event: string, payload: Record<string, unknown>): Promise<void> {
  for (const hook of hooksFor(event)) {
    if (hook.type === "command" && hook.command) {
      await runCommand(
        hook.command,
        JSON.stringify({ ...base(), hook_event_name: event, ...payload }),
      );
      continue;
    }
    const response = await fetch(hook.url ?? "", {
      method: "POST",
      headers: { "content-type": "application/json", ...hook.headers },
      body: JSON.stringify({ ...base(), hook_event_name: event, ...payload }),
    }).catch((error: Error) => ({ status: 0, text: async () => error.message }));
    log({ type: "hook", event, status: response.status, body: await response.text() });
  }
}

const notifications: unknown[] = [];
/** Holder, so the narrowing of a plain `let` does not hide the assignment in openChannel. */
const channel: { client: Client | null } = { client: null };

async function openChannel(): Promise<void> {
  const index = args.indexOf("--mcp-config");
  const config = JSON.parse(readFileSync(args[index + 1] ?? "", "utf8")) as {
    mcpServers: Record<string, { command: string; args: string[] }>;
  };
  const server = Object.values(config.mcpServers)[0];
  const client = new Client({ name: "fake-claude", version: "0.0.0" });
  client.fallbackNotificationHandler = async (notification) => {
    notifications.push(notification);
    log({ type: "channel", notification });
  };
  await client.connect(
    new StdioClientTransport({
      command: server?.command ?? "",
      args: server?.args ?? [],
      env: process.env as Record<string, string>,
      stderr: "inherit",
    }),
  );
  channel.client = client;
  log({ type: "channel-open", capabilities: client.getServerCapabilities() ?? null });
}

async function until(check: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await Bun.sleep(20);
  }
  return true;
}

// `claude --bg` starts the session under the supervisor and returns at once.
if (args.includes("--bg") || args.includes("--background")) {
  console.log("backgrounded · fake0001 · bg");
  process.exit(0);
}
const steps = JSON.parse(readFileSync(join(stateDir, "script.json"), "utf8")) as FakeClaudeStep[];
let code = 0;
for (const step of steps) {
  switch (step.do) {
    case "session-start": {
      sessionId = step.sessionId;
      const dir = join(homedir(), ".claude", "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
      mkdirSync(dir, { recursive: true });
      transcript = join(dir, `${sessionId}.jsonl`);
      if (!existsSync(transcript)) writeFileSync(transcript, "");
      await postHook("SessionStart", { source: step.source ?? "startup" });
      break;
    }
    case "hook":
      await postHook(step.event, step.payload ?? {});
      break;
    case "transcript": {
      const line = {
        type: "user",
        cwd,
        uuid: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        sessionId,
        message: { role: "user", content: step.text },
      };
      appendFileSync(transcript, `${JSON.stringify(line)}\n`);
      break;
    }
    case "channel":
      await openChannel();
      break;
    case "wait-channel":
      log({
        type: "wait-channel",
        ok: await until(() => notifications.length >= step.count, step.timeoutMs ?? 10_000),
      });
      break;
    case "write":
      writeFileSync(join(cwd, step.path), step.text);
      break;
    case "wait-file":
      log({
        type: "wait-file",
        ok: await until(() => existsSync(step.path), step.timeoutMs ?? 10_000),
      });
      break;
    case "otlp": {
      const value = (v: string | number) =>
        typeof v === "number"
          ? Number.isInteger(v)
            ? { intValue: String(v) }
            : { doubleValue: v }
          : { stringValue: v };
      const base = Date.now();
      const body = {
        resourceLogs: [
          {
            resource: { attributes: [] },
            scopeLogs: [
              {
                logRecords: step.events.map((e) => ({
                  timeUnixNano: String(BigInt(base + e.afterMs) * 1_000_000n),
                  body: { stringValue: `claude_code.${e.name}` },
                  attributes: Object.entries({
                    "event.name": `claude_code.${e.name}`,
                    "session.id": sessionId,
                    ...e.attrs,
                  }).map(([key, v]) => ({ key, value: value(v) })),
                })),
              },
            ],
          },
        ],
      };
      const headers = Object.fromEntries(
        (process.env.OTEL_EXPORTER_OTLP_HEADERS ?? "")
          .split(",")
          .map((pair) => pair.split(/=(.*)/s).slice(0, 2) as [string, string]),
      );
      const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      let status = 0;
      if (endpoint) {
        const res = await fetch(`${endpoint}/v1/logs`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        }).catch(() => null);
        status = res?.status ?? -1;
      }
      log({ type: "otlp", status });
      break;
    }
    case "exit":
      code = step.code;
      break;
  }
}
await channel.client?.close();
process.exit(code);
