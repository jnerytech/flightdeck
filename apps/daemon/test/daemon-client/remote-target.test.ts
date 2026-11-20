import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { runOnLocalDaemon, said } from "../../src/daemon-client/index.ts";
import { fakeDaemon, stopAll, stops } from "../board/card-cli-helpers.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const REMOTE_TOKEN = "remote-host-token-aaaaaaaaaaaaaaaa";
const LOCAL_TOKEN = "local-config-token-bbbbbbbbbbbbbbbb";

/** A command that asks `host.info` of the daemon at `port` as the host named "server", with the token the closure gives. */
function ask(port: number, token: string, over: { timeoutMs?: number } = {}) {
  return runOnLocalDaemon({
    config: { bind: "127.0.0.1", port: 1, token: LOCAL_TOKEN },
    remote: { name: "server", url: `ws://127.0.0.1:${port}/v1/ws`, token: () => token },
    clientName: "flightdeck-test",
    timeoutMs: over.timeoutMs ?? 5_000,
    perform: async (daemon) => said(`host ${(await daemon.call("host.info", {})).hostName}`),
  });
}

/** A daemon that, like the real one, closes the socket with 4401 when the hello token is wrong. */
function closingDaemon(): number {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("ws only", { status: 400 })),
    websocket: { message: (ws) => ws.close(4401, "unauthorized") },
  });
  stops.push(() => server.stop(true));
  return server.port as number;
}

describe("a command on a remote host (#3429)", () => {
  test("it asks the remote daemon with the remote token, and the config's token never leaves", async () => {
    const daemon = fakeDaemon({ "host.info": () => ({ hostName: "server-box" }) }, REMOTE_TOKEN);
    const result = await ask(daemon.port, REMOTE_TOKEN);
    expect(result).toEqual({ code: 0, out: ["host server-box"], err: [] });
    expect(JSON.stringify(daemon.calls)).not.toContain(LOCAL_TOKEN);
    expect(daemon.calls[0]).toMatchObject({ type: "hello", payload: { token: REMOTE_TOKEN } });
  });

  test("a refused token is exit 1, token_refused, 'pair again', and the token is nowhere in the words", async () => {
    // This daemon echoes the token it was given in its refusal text: hiding it is the command's job.
    const daemon = fakeDaemon({}, "another-token-cccccccccccccccc");
    const result = await ask(daemon.port, REMOTE_TOKEN);
    expect(result).toEqual({
      code: 1,
      out: [],
      err: ["the token for server was refused: pair this host again in the app"],
      reason: "token_refused",
    });
  });

  test("a daemon that closes the socket with 4401 on a bad token is the same refusal", async () => {
    const result = await ask(closingDaemon(), REMOTE_TOKEN);
    expect(result).toMatchObject({ code: 1, reason: "token_refused" });
    expect(result.err).toEqual([
      "the token for server was refused: pair this host again in the app",
    ]);
  });

  test("nobody at the address is exit 2, unreachable, by the host's name", async () => {
    const probe = fakeDaemon({});
    await stopAll();
    const result = await ask(probe.port, REMOTE_TOKEN);
    expect(result).toEqual({
      code: 2,
      out: [],
      err: ["could not reach server: is its daemon running?"],
      reason: "unreachable",
    });
  });

  test("a daemon that never says hello is exit 2, unreachable, with the wait in seconds", async () => {
    const daemon = fakeDaemon({}, REMOTE_TOKEN, { helloDelayMs: 1_500 });
    const result = await ask(daemon.port, REMOTE_TOKEN, { timeoutMs: 200 });
    expect(result).toEqual({
      code: 2,
      out: [],
      err: ["server did not answer in 1 s"],
      reason: "unreachable",
    });
  });

  test("a refusal of the command itself stays exit 1 and has no reason of its own", async () => {
    const daemon = fakeDaemon(
      {
        "host.info": () => ({ error: { code: "bad_request", message: `no, for ${REMOTE_TOKEN}` } }),
      },
      REMOTE_TOKEN,
    );
    const result = await ask(daemon.port, REMOTE_TOKEN);
    expect(result).toEqual({ code: 1, out: [], err: ["bad_request: no, for [token]"] });
  });
});
