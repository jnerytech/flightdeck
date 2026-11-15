import { afterEach, describe, expect, test } from "bun:test";
import type { DepResult } from "@flightdeck/protocol";
import { checkDeps } from "../../src/deps/domain/deps.ts";
import { type RunningServer, startServer } from "../../src/server.ts";
import { newManager } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { find, machine } from "./check-fixtures.ts";

const TOKEN = "deps-check-token-0123456789abcdef";
const servers: RunningServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.stop();
});

describe("deps-check: over the protocol", () => {
  const serve = (withDeps: boolean) => {
    const { manager } = newManager();
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
      ...(withDeps ? { hostChecks: { deps: () => checkDeps(machine({ without: ["gh"] })) } } : {}),
    });
    servers.push(server);
    return server;
  };

  test("deps.check answers the items, and the host announces the feature", async () => {
    const client = new FrameClient(serve(true).url);
    await client.request("hello", { token: TOKEN, client: "t" });
    const info = await client.data<{ features: string[] }>("host.info", {});
    expect(info?.features).toContain("depsCheck");
    const got = await client.data<{ items: DepResult[] }>("deps.check", {});
    expect(find(got?.items ?? [], "gh").state).toBe("missing");
    client.close();
  });

  test("a host without the check refuses the command and does not announce it", async () => {
    const client = new FrameClient(serve(false).url);
    await client.request("hello", { token: TOKEN, client: "t" });
    const info = await client.data<{ features: string[] }>("host.info", {});
    expect(info?.features).not.toContain("depsCheck");
    const ack = await client.request("deps.check", {});
    expect(ack.ok).toBe(false);
    client.close();
  });
});
