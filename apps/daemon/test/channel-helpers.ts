import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startChannel } from "../src/central/channel.ts";

/**
 * A `flightdeckd claude` stand-in: the channel of `launchId` connected to the receptor at `url`,
 * with an in-memory MCP client playing claude. Returns the texts that reach it.
 */
export async function connectChannel(url: string, token: string, launchId: string) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "claude-de-teste", version: "0.0.0" });
  const received: string[] = [];
  client.fallbackNotificationHandler = async (notification) => {
    received.push(String((notification.params as { content?: unknown } | undefined)?.content));
  };
  const channel = await startChannel({ launchId, url, token, transport: serverSide });
  await client.connect(clientSide);
  return { received, close: () => channel.close() };
}
