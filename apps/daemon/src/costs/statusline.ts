import { existsSync, readFileSync } from "node:fs";
import { type Ack, PROTOCOL_VERSION, parseServerMessage } from "@flightdeck/protocol";
import { Config } from "../config.ts";
import { daemonUrl } from "../mcp.ts";
import type { Quota } from "../quota/quota.ts";
import type { Costs } from "./costs.ts";

/** What `statusline.get` gives: the quota windows, today's cost and the session's. */
export interface StatuslineData {
  windows: Array<{ window: string; utilization: number | null }>;
  todayUsd: number;
  /** `null` without a session id, or for a session without usage. */
  sessionUsd: number | null;
}

/** How long `flightdeckd statusline` waits for everything, stdin included: 250 ms, so the line is out in under the 300 ms of the spec. */
export const STATUSLINE_TIMEOUT_MS = 250;

const LABELS: Record<string, string> = { five_hour: "5h", seven_day: "7d" };

/** The data of the status line, from the host's quota and costs. */
export function statuslineData(opts: {
  quota?: Quota;
  costs?: Costs;
  today: string;
  claudeSessionId?: string;
}): StatuslineData {
  const windows = (opts.quota?.state().windows ?? []).map((w) => ({
    window: w.window,
    utilization: w.utilization,
  }));
  const today = opts.costs?.summary({ from: opts.today, to: opts.today }).totals.costUsd ?? 0;
  const session =
    opts.claudeSessionId && opts.costs ? opts.costs.session(opts.claudeSessionId) : null;
  return {
    windows,
    todayUsd: today,
    sessionUsd: session && session.tokens > 0 ? session.costUsd : null,
  };
}

/** `5h 35% · 7d 27% · hoje $4.20 · sessão $0.84`. */
export function statuslineText(data: StatuslineData): string {
  const parts = data.windows
    .filter((w) => w.utilization !== null)
    .map((w) => `${LABELS[w.window] ?? w.window} ${Math.round((w.utilization as number) * 100)}%`);
  parts.push(`hoje $${data.todayUsd.toFixed(2)}`);
  if (data.sessionUsd !== null) parts.push(`sessão $${data.sessionUsd.toFixed(2)}`);
  return parts.join(" · ");
}

/** The config as it is on disk; `null` when there is none or it does not parse. Never writes. */
export function readConfig(file: string): Config | null {
  if (!existsSync(file)) return null;
  const parsed = Config.safeParse(JSON.parse(readFileSync(file, "utf8")));
  return parsed.success ? parsed.data : null;
}

/** `hello`, then `statusline.get`, over one WebSocket that `close` ends. */
function ask(url: string, token: string, claudeSessionId: string | undefined) {
  const ws = new WebSocket(url);
  const data = new Promise<StatuslineData>((resolve, reject) => {
    ws.addEventListener("open", () => {
      const hello = { token, client: "flightdeckd-statusline", protocolVersion: PROTOCOL_VERSION };
      ws.send(JSON.stringify({ id: "1", type: "hello", payload: hello }));
    });
    ws.addEventListener("message", (msg) => {
      const frame = parseServerMessage(String(msg.data)) as Ack | { type: string };
      if (frame.type !== "ack") return;
      const ack = frame as Ack;
      if (!ack.ok) return reject(new Error(ack.error.message));
      if (ack.id === "1") {
        const payload = claudeSessionId ? { claudeSessionId } : {};
        ws.send(JSON.stringify({ id: "2", type: "statusline.get", payload }));
        return;
      }
      resolve(ack.data as StatuslineData);
    });
    ws.addEventListener("error", () => reject(new Error("daemon fora do ar")));
  });
  return { data, close: () => ws.close() };
}

/**
 * `flightdeckd statusline`: Claude Code's JSON on stdin, one line on stdout. The config is only
 * read (never created), and anything that fails or takes longer than `timeoutMs` (250 ms when
 * absent, stdin included) gives an empty line.
 */
export async function runStatusline(opts: {
  configFile: string;
  stdin: ReadableStream<Uint8Array>;
  timeoutMs?: number;
}): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let close = () => {};
  const deadline = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(""), opts.timeoutMs ?? STATUSLINE_TIMEOUT_MS);
  });
  const work = (async () => {
    const config = readConfig(opts.configFile);
    if (!config) return "";
    const input = JSON.parse((await new Response(opts.stdin).text()) || "{}");
    const id = typeof input.session_id === "string" ? input.session_id : undefined;
    const asked = ask(daemonUrl(config), config.token, id);
    close = asked.close;
    return statuslineText(await asked.data);
  })().catch(() => "");
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    close();
  }
}
