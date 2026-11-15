import { describe, expect, test } from "bun:test";
import { httpReady, waitForServer } from "../../src/runenv/preview.ts";

describe("preview: a real HTTP server", () => {
  test("a sonda real: qualquer resposta HTTP conta, até um 404; ninguém ouvindo, não", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("não achei", { status: 404 }),
    });
    const url = `http://127.0.0.1:${server.port}/`;
    expect(await httpReady(url)).toBe(true);
    await server.stop(true);
    expect(await httpReady(url)).toBe(false);
  });
  test("um servidor no ar é ready logo, e um Run parado nem sonda", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
    const url = `http://127.0.0.1:${server.port}/`;
    expect(await waitForServer(url, () => false)).toBe("ready");
    expect(await waitForServer(url, () => true)).toBe("stopped");
    await server.stop(true);
  });
});
