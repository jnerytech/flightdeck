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

const [stateDir = "", ...args] = process.argv.slice(2);
const log = (entry: Record<string, unknown>) =>
  appendFileSync(join(stateDir, "events.jsonl"), `${JSON.stringify(entry)}\n`);
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.startsWith("FLIGHTDECK_")),
);
log({ type: "start", args, env });

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

/** Command hooks go through the shell, as Claude Code runs them. */
function runCommand(command: string, input: string): void {
  const windows = process.platform === "win32";
  const proc = Bun.spawnSync(
    windows ? ["cmd.exe", "/d", "/s", "/c", `"${command}"`] : ["sh", "-c", command],
    {
      env: process.env,
      stdin: new TextEncoder().encode(input),
      stdout: "pipe",
      stderr: "pipe",
      windowsVerbatimArguments: windows,
    } as Parameters<typeof Bun.spawnSync>[1],
  );
  log({ type: "command", command, code: proc.exitCode, stdout: proc.stdout?.toString() ?? "" });
}

async function postHook(event: string, payload: Record<string, unknown>): Promise<void> {
  for (const hook of hooksFor(event)) {
    if (hook.type === "command" && hook.command) {
      runCommand(hook.command, JSON.stringify({ ...base(), hook_event_name: event, ...payload }));
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
    case "exit":
      code = step.code;
      break;
  }
}
await channel.client?.close();
process.exit(code);
