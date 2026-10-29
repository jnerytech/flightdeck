import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export const CHANNEL_INSTRUCTIONS =
  "As mensagens deste canal vêm do usuário pelo app Flightdeck. Trate cada uma como o próximo " +
  "prompt dele, exatamente como se ele tivesse digitado no terminal.";

export interface ChannelOptions {
  launchId: string;
  /** Receptor base URL of the local daemon. */
  url: string;
  /** `hooks.token`. */
  token: string;
  /** Where Claude Code speaks MCP to us: stdio for real, in memory in tests. */
  transport: Transport;
}

export interface Channel {
  /** Resolves when claude closes the channel (or `close` is called). */
  closed: Promise<void>;
  close(): Promise<void>;
}

/** WebSocket to the receptor, identified by the launch id; rejects when refused. */
function connect(opts: ChannelOptions): Promise<WebSocket> {
  const url = `${opts.url.replace(/^http/, "ws")}/channel?launch=${encodeURIComponent(opts.launchId)}`;
  // Bun's WebSocket takes headers; the receptor only accepts the hooks token.
  const ws = new WebSocket(url, {
    headers: { Authorization: `Bearer ${opts.token}` },
  } as unknown as string[]);
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", () => reject(new Error("o receptor recusou a conexão")), {
      once: true,
    });
  });
}

/**
 * `flightdeckd channel`: a one-way MCP channel server (research preview of Claude Code). It
 * declares `claude/channel`, has no tools and no permission relay (approvals go through the
 * hook), and pushes each message the daemon sends for its launch as `notifications/claude/channel`.
 */
export async function startChannel(opts: ChannelOptions): Promise<Channel> {
  const socket = await connect(opts);
  const server = new Server(
    { name: "flightdeck", version: "1.0.0" },
    {
      capabilities: { experimental: { "claude/channel": {} } },
      instructions: CHANNEL_INSTRUCTIONS,
    },
  );
  socket.addEventListener("message", (msg) => {
    const { text } = JSON.parse(String(msg.data)) as { text: string };
    void server.notification({
      method: "notifications/claude/channel",
      params: { content: text, meta: { from: "flightdeck" } },
    } as never);
  });
  const { promise: closed, resolve: done } = Promise.withResolvers<void>();
  // Claude closed the transport (it exited): drop the receptor connection too.
  server.onclose = () => {
    socket.close();
    done();
  };
  await server.connect(opts.transport);
  return { closed, close: () => server.close() };
}
