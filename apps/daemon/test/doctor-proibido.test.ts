import { afterEach, describe, expect, test } from "bun:test";
import { runDoctor } from "../src/doctor.ts";
import { type RunningServer, startServer } from "../src/server.ts";
import { refusedAddress } from "../src/update.ts";
import { newManager } from "./helpers.ts";

const servers: Array<RunningServer | { stop(close?: boolean): unknown }> = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.stop();
});

function serve(allowedNetworks: string[]) {
  const { manager } = newManager();
  const server = startServer({
    manager,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: "doctor-proibido-token-0123456789",
    allowedRoots: [],
    allowedNetworks,
  });
  servers.push(server);
  return server;
}

const healthOf = (url: string) => url.replace("ws://", "http://").replace("/v1/ws", "/health");

describe("doctor-proibido", () => {
  test("an address outside allowedNetworks is told its own address in the 403", async () => {
    const server = serve(["10.0.0.0/8"]);
    const answer = await fetch(healthOf(server.url));
    expect(answer.status).toBe(403);
    expect(await answer.text()).toBe("forbidden: 127.0.0.1");
  });

  test("refusedAddress reads that address, and answers null for a healthy daemon or nothing listening", async () => {
    expect(await refusedAddress(healthOf(serve(["10.0.0.0/8"]).url), 1000)).toBe("127.0.0.1");
    expect(await refusedAddress(healthOf(serve(["127.0.0.0/8"]).url), 1000)).toBeNull();
    expect(await refusedAddress("http://127.0.0.1:1/health", 1000)).toBeNull();
    const other = Bun.serve({ port: 0, fetch: () => new Response("forbidden", { status: 403 }) });
    servers.push(other);
    expect(await refusedAddress(`http://127.0.0.1:${other.port}/health`, 1000)).toBeNull();
  });

  test("the doctor names the refused address and the fix instead of saying nothing answers", async () => {
    const base = {
      config: () => ({ bind: "100.64.0.9", port: 7777, allowedRoots: ["/code"] }),
      isDirectory: () => true,
      serviceInstalled: async () => true,
      healthy: async () => false,
      tailscaleIp: async () => null,
      hooks: () => "installed" as const,
      claudePath: () => "/usr/bin/claude",
    };
    const refused = await runDoctor({ ...base, refused: async () => "100.64.0.9" });
    const daemon = refused.checks.find((c) => c.id === "daemon");
    expect(daemon).toMatchObject({ status: "fail" });
    expect(daemon?.detail).toBe(
      "the daemon refused this machine's address (100.64.0.9): add its network to allowedNetworks (or run flightdeckd setup)",
    );
    expect(daemon?.fix).toContain("flightdeckd setup");
    const down = await runDoctor({ ...base, refused: async () => null });
    expect(down.checks.find((c) => c.id === "daemon")?.detail).toBe(
      "nothing answers on 100.64.0.9:7777",
    );
  });
});
