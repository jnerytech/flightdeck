/**
 * The hosts the demo seed starts: one `--runtime fake` daemon in this process with its protocol
 * client, the OTLP telemetry a session sends and the lagging-branch cards. Whatever writes files
 * without a daemon lives in `seed-files.ts`.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Ack, parseServerMessage } from "@flightdeck/protocol";
import { startDaemon } from "../../../apps/daemon/src/main.ts";
import { serializeTemplate } from "../../../apps/daemon/src/templates/domain/template-file.ts";
import { DEMO_UPDATE_CARDS } from "../e2e/journeys.ts";
import { demoHostSetup } from "./hosts.ts";
import { laggingBranches } from "./lagging.ts";
import { git, writeHistory } from "./seed-files.ts";

/**
 * #1406: the cards of `DEMO_UPDATE_CARDS`, each on a branch that lags behind main, the last in
 * conflict with it (`laggingBranches`). No session runs: the cards are pointed at the worktrees in
 * the host's database, as the PR cards are.
 */
export async function laggingCards(
  client: Client,
  where: { projectId: string; repo: string; worktrees: string; db: string },
): Promise<void> {
  const ids: string[] = [];
  for (const title of DEMO_UPDATE_CARDS) {
    const creating = client.call<{ id: string }>("card.create", {
      projectId: where.projectId,
      title,
      description: "Atualize com a base depois que a main andar.",
    });
    const card = await creating; // NOSONAR: one after the other, so the board lists them in this order
    ids.push(card.id);
  }
  const branches = laggingBranches(git, where.repo, where.worktrees, ids.length);
  const db = new Database(where.db);
  for (const [i, id] of ids.entries()) {
    const made = branches[i];
    if (!made) continue;
    db.query("UPDATE cards SET branch = ?, worktree_path = ? WHERE id = ?").run(
      made.branch,
      made.path,
      id,
    );
  }
  db.close();
}

/** A protocol client that answers pings and keeps `external.watch` open (requests stay held). */
class Client {
  private readonly ws: WebSocket;
  private readonly acks = new Map<string, (ack: Ack) => void>();
  /** The open permission request of each session, from the summaries (`sessions.watch`). */
  readonly requests = new Map<string, string | undefined>();
  private seq = 0;

  private constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener("message", (msg) => {
      const frame = parseServerMessage(String(msg.data));
      if (frame.type === "ack") this.acks.get(frame.id)?.(frame);
      else if (frame.type === "event" && frame.event.type === "session.summary") {
        this.requests.set(frame.sessionId, frame.event.pendingPermissions[0]?.requestId);
      } else if (frame.type === "ping")
        this.ws.send(JSON.stringify({ type: "pong", id: frame.id }));
    });
  }

  static async open(url: string, token: string): Promise<Client> {
    const client = new Client(url);
    await new Promise((ok) => client.ws.addEventListener("open", ok, { once: true }));
    await client.call("hello", { token, client: "flightdeck-demo-seed" });
    await client.call("sessions.watch", {});
    return client;
  }

  call<T = unknown>(type: string, payload: object): Promise<T> {
    const id = String(++this.seq);
    return new Promise((ok, fail) => {
      this.acks.set(id, (ack) =>
        ack.ok ? ok(ack.data as T) : fail(new Error(`${type}: ${ack.error.message}`)),
      );
      this.ws.send(JSON.stringify({ id, type, payload }));
    });
  }

  close(): void {
    this.ws.close();
  }
}

export async function until<T>(
  check: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  what: string,
): Promise<T> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const value = await check(); // NOSONAR: sequential by design: each pass needs the answer of the one before
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`demo: tempo esgotado em ${what}`);
    await Bun.sleep(50); // NOSONAR: poll interval: the wait between looks is the point of this loop
  }
}

interface HostRun {
  url: string;
  token: string;
  client: Client;
  config: string;
  projects: string;
  /** Where the host's Claude transcripts are indexed from. */
  claudeProjects: string;
  /** The daemon's data folder: where it publishes its OTLP receiver (phase 23). */
  dataDir: string;
  /** The host's memory reading (issue #1364): a file with the share in use (0 to 1); none means no reading. */
  memoryFile: string;
  stop(): Promise<void>;
}

/** The memory the demo host reports: the share in use that its file holds, or no reading without it. */
function demoMemory(file: string): { totalBytes: number; freeBytes: number } | null {
  if (!existsSync(file)) return null;
  const used = Number(readFileSync(file, "utf8").trim());
  return Number.isFinite(used)
    ? { totalBytes: 1000, freeBytes: Math.round((1 - used) * 1000) }
    : null;
}

export async function host(work: string, name: string): Promise<HostRun> {
  const setup = demoHostSetup(name);
  const base = join(work, name);
  const memoryFile = join(base, "memory");
  const projects = join(base, "projects");
  const history = join(base, "claude-projects");
  mkdirSync(projects, { recursive: true });
  mkdirSync(history, { recursive: true });
  // Only alfa's: on beta the same session would already be there, and a move refuses it.
  writeHistory(history, join(projects, "flightdeck-web"), name === "alfa");
  mkdirSync(join(projects, "notes"), { recursive: true });
  // A host's own task for simple mode's Home (phase 33): a Markdown file in the templates folder.
  mkdirSync(join(base, "data", "templates"), { recursive: true });
  writeFileSync(
    join(base, "data", "templates", "demo-notes.md"),
    serializeTemplate({
      id: "demo-notes",
      title: { en: "Tidy my notes", "pt-BR": "Arrumar minhas notas" },
      description: {
        en: "Fixes spelling and headings in a folder of notes.",
        "pt-BR": "Corrige a ortografia e os títulos de uma pasta de notas.",
      },
      icon: "notebook",
      fields: [{ id: "folder", kind: "folder", label: { en: "Folder", "pt-BR": "Pasta" } }],
      prompt: { en: "Tidy the notes in {folder}.", "pt-BR": "Arrume as notas em {folder}." },
      preset: "edit_folder",
      planFirst: false,
    }),
  );
  // One that asks before it writes and leaves a summary behind: the question and the result.
  writeFileSync(
    join(base, "data", "templates", "demo-summary.md"),
    serializeTemplate({
      id: "demo-summary",
      // One name for both languages: the BDD scenario finds the card by it in the language of its run.
      title: { en: "Write a summary", "pt-BR": "Write a summary" },
      description: {
        en: "Reads a folder of notes and writes a short summary.",
        "pt-BR": "Lê uma pasta de notas e escreve um resumo curto.",
      },
      icon: "file-text",
      fields: [{ id: "folder", kind: "folder", label: { en: "Folder", "pt-BR": "Pasta" } }],
      prompt: {
        en: "[tool] [result:Flightdeck results/summary.md] Summarize the notes in {folder}.",
        "pt-BR": "[tool] [result:Flightdeck results/summary.md] Resuma as notas em {folder}.",
      },
      preset: "ask_before_changes",
      planFirst: false,
    }),
  );
  const token = crypto.randomUUID().replaceAll("-", "");
  const config = join(base, "config.json");
  writeFileSync(
    config,
    JSON.stringify({
      hostName: name,
      port: 0,
      token,
      dataDir: join(base, "data"),
      allowedRoots: [projects],
      runtime: "fake",
      // The demo asks for permissions (a Bash request, a Write request) and shows the mode chip: the
      // host keeps the default it had before bypass became the default (#3427).
      allowBypassPermissions: false,
      // The hooks token and a free port for the OTLP receiver, which listens once hooks are set up.
      hooks: { port: 0, token: crypto.randomUUID().replaceAll("-", "") },
      telemetry: { port: 0 },
      history: { roots: [history] },
    }),
  );
  const quiet = { log: () => {}, error: (m: string) => console.error(`  [${name}] ${m}`) };
  const daemon = await startDaemon(
    { command: "start", config, runtime: "fake" },
    { ...process.env },
    quiet,
    // The health check asks the machine's service manager; the demo says what no machine can change
    // (issue #1200): linger is on, and the service is installed only where the demo says (#1520), so
    // every run reads the same.
    {
      serviceInstalled: async () => setup.serviceInstalled,
      linger: async () => "on",
      // Issue #1364: the memory the hold on new cards reads is a file the journeys write, never the
      // machine's own (a busy runner would hold every card). No file is no reading, so nothing waits.
      memoryReading: () => demoMemory(memoryFile),
    },
  );
  const client = await Client.open(daemon.url, token);
  return {
    url: daemon.url,
    token,
    client,
    config,
    projects,
    claudeProjects: history,
    dataDir: join(base, "data"),
    memoryFile,
    stop: async () => {
      client.close();
      await daemon.stop();
    },
  };
}

/** The OTLP log records of one prompt, in the shape Claude Code's exporter sends. */
interface DemoEvent {
  name: string;
  afterMs: number;
  attrs: Record<string, string | number>;
}

/** Sends events to the host's OTLP receiver, as an exporter would: the same path as a real session. */
export async function sendTelemetry(
  host: HostRun,
  sessionId: string,
  promptId: string,
  startedAt: number,
  events: DemoEvent[],
): Promise<void> {
  const published = JSON.parse(readFileSync(join(host.dataDir, "telemetry.json"), "utf8")) as {
    url: string;
  };
  const token = (JSON.parse(readFileSync(host.config, "utf8")) as { telemetry: { token: string } })
    .telemetry.token;
  const value = (v: string | number) => {
    if (typeof v !== "number") return { stringValue: v };
    return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  };
  const body = {
    resourceLogs: [
      {
        resource: { attributes: [] },
        scopeLogs: [
          {
            logRecords: events.map((e) => ({
              timeUnixNano: String(BigInt(startedAt + e.afterMs) * 1_000_000n),
              body: { stringValue: `claude_code.${e.name}` },
              attributes: Object.entries({
                "event.name": `claude_code.${e.name}`,
                "session.id": sessionId,
                "prompt.id": promptId,
                ...e.attrs,
              }).map(([key, v]) => ({ key, value: value(v) })),
            })),
          },
        ],
      },
    ],
  };
  const res = await fetch(`${published.url}/v1/logs`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`telemetria do demo: ${res.status}`);
}

/** Two prompts: API requests, a permission you answered after 9 s, a slow Bash, an API error. */
export const PROMPT_ONE: DemoEvent[] = [
  { name: "user_prompt", afterMs: 0, attrs: { prompt_length: 42 } },
  {
    name: "api_request",
    afterMs: 1_200,
    attrs: { request_id: "r1", duration_ms: 1_100, cost_usd: 0.012, model: "claude-opus-5-5" },
  },
  {
    name: "tool_decision",
    afterMs: 1_300,
    attrs: { tool_use_id: "t1", tool_name: "Read", decision: "accept", source: "config" },
  },
  {
    name: "tool_result",
    afterMs: 1_450,
    attrs: { tool_use_id: "t1", tool_name: "Read", duration_ms: 120, success: "true" },
  },
  {
    name: "api_request",
    afterMs: 3_000,
    attrs: { request_id: "r2", duration_ms: 1_400, cost_usd: 0.018, model: "claude-opus-5-5" },
  },
  {
    name: "tool_decision",
    afterMs: 12_000,
    attrs: { tool_use_id: "t2", tool_name: "Bash", decision: "accept", source: "user_temporary" },
  },
  {
    name: "tool_result",
    afterMs: 16_200,
    attrs: { tool_use_id: "t2", tool_name: "Bash", duration_ms: 4_200, success: "true" },
  },
  {
    name: "api_error",
    afterMs: 17_000,
    attrs: { request_id: "r3", status_code: 529, duration_ms: 90 },
  },
];
export const PROMPT_TWO: DemoEvent[] = [
  { name: "user_prompt", afterMs: 0, attrs: { prompt_length: 18 } },
  {
    name: "api_request",
    afterMs: 900,
    attrs: { request_id: "r4", duration_ms: 800, cost_usd: 0.009, model: "claude-opus-5-5" },
  },
  {
    name: "tool_decision",
    afterMs: 1_000,
    attrs: { tool_use_id: "t3", tool_name: "Edit", decision: "accept", source: "config" },
  },
  {
    name: "tool_result",
    afterMs: 1_300,
    attrs: { tool_use_id: "t3", tool_name: "Edit", duration_ms: 300, success: "true" },
  },
];
