import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { delimiter } from "node:path";
import { ServeFailed, startPrivateServer } from "../src/runtime/opencode-serve.ts";
import { manualTimers } from "./fake-acp-agent.ts";
import { installFakeOpenCode } from "./fake-opencode.ts";
import { poll, tempDir } from "./helpers.ts";

// Each case boots a Bun process or three: more than the default 5 s on a loaded machine.
setDefaultTimeout(30_000);

const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function setup(mode = "", over: Partial<Parameters<typeof startPrivateServer>[0]> = {}) {
  const fake = installFakeOpenCode();
  const ledger: string[] = [];
  const opts = {
    path: fake.path,
    cwd: tempDir("fd-serve-"),
    env: {
      PATH: `${fake.dir}${delimiter}${process.env.PATH ?? ""}`,
      HOME: "/home/u",
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_CONFIG_CONTENT: "{}",
      ...(mode ? { FAKE_OPENCODE_SERVE: mode } : {}),
    },
    timeoutMs: 30_000,
    ledger: {
      add: (pid: number) => ledger.push(`add ${pid}`),
      release: (pid: number) => ledger.push(`release ${pid}`),
    },
    ...over,
  };
  const start = async () => {
    const server = await startPrivateServer(opts);
    stops.push(() => server.stop());
    return server;
  };
  return { fake, ledger, opts, start };
}

const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof ServeFailed ? error.message : `other: ${String(error)}`;
  }
};

describe("opencode-serve: one private server for a preflight (issue #243)", () => {
  test("it starts `serve` on loopback in the folder, with project config off, and answers the routes with the password", async () => {
    const { fake, opts, start } = setup();
    const server = await start();
    expect(await server.get("/api/permission/saved")).toEqual({ data: [] });
    expect(Array.isArray(await server.get("/api/config"))).toBe(true);
    const serving = fake.calls().find((c) => c.args[0] === "serve");
    expect(serving?.args).toEqual(["serve", "--port", "0", "--hostname", "127.0.0.1"]);
    expect([serving?.cwd, serving?.disableProjectConfig]).toEqual([opts.cwd, "1"]);
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const requests = fake.calls().filter((c) => c.args[0] === "GET");
    expect(requests.map((c) => c.authorized)).toEqual([true, true]);
  });

  test("without the password the server answers 401: it is not for anyone else on the machine", async () => {
    const { start } = setup();
    const server = await start();
    expect((await fetch(`${server.url}/api/config`)).status).toBe(401);
    expect(
      (await fetch(`${server.url}/api/config`, { headers: { authorization: "Basic eDp5" } }))
        .status,
    ).toBe(401);
  });

  test("the process group is written to the ledger once it listens, and released and ended on stop; stop twice is once", async () => {
    const { ledger, start } = setup();
    const server = await start();
    expect(ledger).toEqual([`add ${server.pid}`]);
    expect(alive(server.pid)).toBe(true);
    await server.stop();
    await server.stop();
    expect(await poll(() => !alive(server.pid))).toBe(true);
    expect(ledger).toEqual([`add ${server.pid}`, `release ${server.pid}`]);
  });

  test("a server that never listens fails at the limit with its process ended, and writes nothing to the ledger", async () => {
    const timers = manualTimers();
    const { fake, ledger, opts } = setup("hang", { timers });
    const starting = startPrivateServer(opts);
    // The process is up and silent; only then does the limit pass.
    expect(await poll(() => fake.calls().some((c) => c.args[0] === "serve"))).toBe(true);
    timers.advance(30_000);
    expect(await refusal(starting)).toBe("opencode serve did not listen in time");
    expect(ledger).toEqual([]);
  });

  test("a server that exits at once fails with its exit code, never what it printed", async () => {
    const { start } = setup("exit");
    expect(await refusal(start())).toBe("opencode serve exited 3");
  });

  test("a route that never answers fails at the limit, a 500 and a non-JSON body fail with the route only", async () => {
    const timers = manualTimers();
    const silent = setup("silent", { timers });
    const server = await silent.start();
    const asking = server.get("/api/config");
    expect(await poll(() => silent.fake.calls().some((c) => c.args[0] === "GET"))).toBe(true);
    timers.advance(30_000);
    expect(await refusal(asking)).toBe("/api/config did not answer in time");
    const bad = await setup("http500").start();
    expect(await refusal(bad.get("/api/agent"))).toBe("/api/agent answered HTTP 500");
    const text = await setup("notjson").start();
    expect(await refusal(text.get("/api/agent"))).toBe(
      "/api/agent answered something that is not JSON",
    );
  });
});
