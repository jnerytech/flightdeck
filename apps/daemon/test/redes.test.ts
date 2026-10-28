import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { DEFAULT_ALLOWED_NETWORKS, ipInNetworks } from "../src/networks.ts";
import { type RunningServer, startServer } from "../src/server.ts";
import { newManager, tempDir } from "./helpers.ts";

const TOKEN = "redes-token-0123456789abcdef";
const servers: RunningServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.stop();
});

function serve(allowedNetworks?: string[]) {
  const { manager } = newManager();
  const server = startServer({
    manager,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
    ...(allowedNetworks ? { allowedNetworks } : {}),
  });
  servers.push(server);
  return server;
}

function hello(url: string): Promise<{ ok: boolean } | { closed: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () =>
      ws.send(JSON.stringify({ id: "1", type: "hello", payload: { token: TOKEN, client: "t" } })),
    );
    ws.addEventListener("message", (m) => {
      resolve({ ok: JSON.parse(String(m.data)).ok });
      ws.close();
    });
    ws.addEventListener("close", (e) => resolve({ closed: e.code }));
  });
}

describe("redes", () => {
  test("CIDR IPv4, IPv6 e IPv4 mapeado em IPv6", () => {
    expect(ipInNetworks("127.0.0.1", ["127.0.0.0/8"])).toBe(true);
    expect(ipInNetworks("::ffff:127.0.0.1", ["127.0.0.0/8"])).toBe(true);
    expect(ipInNetworks("10.1.2.3", ["127.0.0.0/8"])).toBe(false);
    expect(ipInNetworks("::1", ["::1/128"])).toBe(true);
    expect(ipInNetworks("::2", ["::1/128"])).toBe(false);
    expect(ipInNetworks("100.100.1.1", ["100.64.0.0/10"])).toBe(true);
    expect(ipInNetworks("100.128.0.1", ["100.64.0.0/10"])).toBe(false);
    expect(ipInNetworks("fd7a:115c:a1e0:ab12::1", ["fd7a:115c:a1e0::/48"])).toBe(true);
    expect(ipInNetworks("fd7a:115c:a1e1::1", ["fd7a:115c:a1e0::/48"])).toBe(false);
    expect(ipInNetworks("10.0.0.1", ["0.0.0.0/0"])).toBe(true);
    expect(ipInNetworks("10.0.0.1", ["::/0"])).toBe(false);
    expect(ipInNetworks("lixo", ["0.0.0.0/0"])).toBe(false);
  });

  test("padrão é só loopback; CIDR inválido é recusado na config", () => {
    expect(DEFAULT_ALLOWED_NETWORKS).toEqual(["127.0.0.0/8", "::1/128"]);
    const file = join(tempDir(), "config.json");
    writeFileSync(file, JSON.stringify({ token: "t".repeat(32) }));
    expect(loadConfig(file).allowedNetworks).toEqual(["127.0.0.0/8", "::1/128"]);
    for (const bad of ["10.0.0.0", "10.0.0.0/33", "300.0.0.0/8", "::1/129", "x/8"]) {
      writeFileSync(file, JSON.stringify({ token: "t".repeat(32), allowedNetworks: [bad] }));
      expect(() => loadConfig(file)).toThrow();
    }
  });

  test("origem fora de allowedNetworks recebe 403 antes do upgrade", async () => {
    const server = serve(["10.0.0.0/8"]);
    const http = server.url.replace("ws://", "http://");
    expect((await fetch(http)).status).toBe(403);
    expect((await fetch(http.replace("/v1/ws", "/health"))).status).toBe(403);
    // A refused handshake surfaces in the client as an abnormal close (1006).
    expect(await hello(server.url)).toEqual({ closed: 1006 });
  });

  test("origem dentro de allowedNetworks segue para o hello", async () => {
    expect(await hello(serve().url)).toEqual({ ok: true });
    expect(await hello(serve(["127.0.0.0/8"]).url)).toEqual({ ok: true });
  });
});
