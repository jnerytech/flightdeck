import { afterEach, describe, expect, test } from "bun:test";
import type { ProjectTrustState } from "@flightdeck/protocol";
import { type RunningServer, startServer } from "../src/server.ts";
import { newManager } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "trust-transport-token-0123456789abcdef";
const servers: RunningServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
});

/** A server whose peer is `peer`, with a trust object that records what was decided. */
function serve(peer: string | null) {
  const { manager, root, project } = newManager();
  const decided: Array<[string, boolean]> = [];
  const state = (path: string, trusted: boolean): ProjectTrustState => ({
    path,
    trusted,
    via: trusted ? path : null,
  });
  const server = startServer({
    manager,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [root],
    allowedNetworks: ["0.0.0.0/0", "::/0"],
    ...(peer ? { peerOf: () => peer } : {}),
    projectTrust: {
      state: (paths) => paths.map((p) => state(p, false)),
      inspect: async (path) => ({
        path,
        hooks: [],
        mcpServers: [],
        envKeys: [],
        allowRules: [],
        defaultMode: null,
        agents: [],
        skills: [],
        commands: [],
        claudeMd: false,
        unreadable: [],
        omitted: { hooks: 0, mcpServers: 0, allowRules: 0, envKeys: 0 },
      }),
      set: (path, trusted) => {
        decided.push([path, trusted]);
        return state(path, trusted);
      },
    },
  });
  servers.push(server);
  return { server, project, decided };
}

async function refusal(client: FrameClient, type: string, payload: unknown) {
  const ack = await client.request(type, payload);
  const error = ack.error as { code?: string; reason?: string } | undefined;
  return ack.ok === true ? "ok" : `${error?.code}/${error?.reason}`;
}

describe("trust-transport: trusting lets a project's code run unasked, so only a near connection may do it (#196)", () => {
  test("from outside loopback and Tailscale, trusting is refused and nothing is decided; revoking and reading pass", async () => {
    const { server, project, decided } = serve("8.8.8.8");
    const client = new FrameClient(server.url);
    await client.request("hello", { token: TOKEN, client: "t" });
    expect(await refusal(client, "project.trust.set", { path: project, trusted: true })).toBe(
      "invalid_state/transport_refused",
    );
    expect(decided).toEqual([]);
    expect(await refusal(client, "project.trust.set", { path: project, trusted: false })).toBe(
      "ok",
    );
    expect(decided).toEqual([[expect.any(String), false]]);
    expect(await refusal(client, "project.trust.state", { paths: [project] })).toBe("ok");
    expect(await refusal(client, "project.trust.inspect", { path: project })).toBe("ok");
    client.close();
  });

  test("from loopback, trusting passes", async () => {
    const { server, project, decided } = serve(null);
    const client = new FrameClient(server.url);
    await client.request("hello", { token: TOKEN, client: "t" });
    expect(await refusal(client, "project.trust.set", { path: project, trusted: true })).toBe("ok");
    expect(decided.at(-1)?.[1]).toBe(true);
    client.close();
  });
});
