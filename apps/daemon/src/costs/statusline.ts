import { readFile } from "node:fs/promises";
import { type Ack, PROTOCOL_VERSION, parseServerMessage } from "@flightdeck/protocol";
import { z } from "zod";
import { Config } from "../config.ts";
import { daemonUrl } from "../daemon-client/index.ts";
import { parseJsonOr, parseJsonWith } from "../kernel/index.ts";
import { STATUSLINE_TIMEOUT_MS, type StatuslineData, statuslineText } from "./domain/statusline.ts";

/** What Claude Code sends on stdin; only the session id is used, and a wrong one reads as none. */
const Stdin = z.looseObject({ session_id: z.string().optional().catch(undefined) });

/** The config as it is on disk; `null` when there is none or it does not parse. Never writes. */
export async function readConfig(file: string): Promise<Config | null> {
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) return null;
  return parseJsonOr(Config.nullable(), text, null);
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
    const config = await readConfig(opts.configFile);
    if (!config) return "";
    const input = parseJsonWith(Stdin, (await new Response(opts.stdin).text()) || "{}");
    const asked = ask(daemonUrl(config), config.token, input.session_id);
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
