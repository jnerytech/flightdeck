import { describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:net";
import { DEFAULT_DEMO_PORT, demoPort, freePort } from "../lib/demo-port.ts";

const free = async () => 40_123;

/** Listens on a port (0 lets the OS pick) and says which one it got. */
function listen(port: number): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: typeof address === "object" && address ? address.port : 0 });
    });
  });
}

describe("the demo's port", () => {
  test("DEMO_PORT is the port, even for a run that would pick a free one", async () => {
    expect(await demoPort({ DEMO_PORT: "4321" }, ["--serve"], free)).toBe(4321);
    expect(await demoPort({ DEMO_PORT: "4321" }, [], free)).toBe(4321);
  });

  test("a plain `bun run demo` keeps 1420, for the person who types it into a browser", async () => {
    expect(DEFAULT_DEMO_PORT).toBe(1420);
    expect(await demoPort({}, [], free)).toBe(1420);
  });

  test("the e2e run (--serve) and the prints (--shots) take a free port", async () => {
    expect(await demoPort({}, ["--serve"], free)).toBe(40_123);
    expect(await demoPort({}, ["--shots"], free)).toBe(40_123);
  });

  test("an empty DEMO_PORT counts as unset", async () => {
    expect(await demoPort({ DEMO_PORT: "" }, [], free)).toBe(1420);
    expect(await demoPort({ DEMO_PORT: "" }, ["--serve"], free)).toBe(40_123);
  });

  test.each(["abc", "0", "70000", "14.5", "-1", "1e3", " 80"])(
    "DEMO_PORT=%p is refused, naming the variable",
    async (bad) => {
      await expect(demoPort({ DEMO_PORT: bad }, [], free)).rejects.toThrow("DEMO_PORT");
    },
  );
});

describe("a free port", () => {
  test("is a real port that can be listened on right away", async () => {
    const port = await freePort();
    expect(Number.isInteger(port) && port > 0 && port < 65_536).toBe(true);
    const held = await listen(port);
    held.server.close();
    expect(held.port).toBe(port);
  });

  test("two runs side by side get different ports while the first is still in use", async () => {
    const first = await listen(await freePort());
    const second = await freePort();
    first.server.close();
    expect(second).not.toBe(first.port);
  });
});
