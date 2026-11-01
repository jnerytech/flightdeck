import { afterEach, describe, expect, test } from "bun:test";
import { type CliResult, type PinStore, type PluginCli, Plugins } from "../src/plugins/plugins.ts";
import { startServer } from "../src/server.ts";
import { newBoard } from "./board-helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "tok-parar";
const NONE: PinStore = { all: () => ({}), set: () => {}, delete: () => {} };

/** A CLI whose first call waits until `release()`, and that records every call. */
function gated() {
  const calls: string[][] = [];
  let release: () => void = () => {};
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reply = (args: string[]): CliResult => ({
    code: 0,
    stdout: args[0] === "marketplace" ? "[]" : JSON.stringify({ installed: [], available: [] }),
    stderr: "",
  });
  const cli: PluginCli = {
    run: async (args) => {
      calls.push(args);
      if (calls.length === 1) await open;
      return reply(args);
    },
  };
  return { cli, calls, release: () => release() };
}

const until = async (check: () => boolean) => {
  const deadline = Date.now() + 3000;
  while (!check() && Date.now() < deadline) await Bun.sleep(5);
};

const stops: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of stops.splice(0).reverse()) await fn();
});

describe("plugins: parar", () => {
  test("depois de close, uma listagem em andamento não começa a próxima chamada da CLI", async () => {
    const { cli, calls, release } = gated();
    const plugins = new Plugins({ cli, pins: NONE });
    const listing = plugins.list().catch((error: { code?: string }) => error.code);
    await until(() => calls.length === 1);
    plugins.close();
    release();
    expect(await listing).toBe("invalid_state");
    expect(calls.map((c) => c[0])).toEqual(["list"]);
  });

  test("depois de close, nenhuma chamada nova começa: recusa com invalid_state", async () => {
    const { cli, calls, release } = gated();
    release();
    const plugins = new Plugins({ cli, pins: NONE });
    plugins.close();
    await expect(plugins.list()).rejects.toMatchObject({ code: "invalid_state" });
    await expect(plugins.detail("a@b")).rejects.toMatchObject({ code: "invalid_state" });
    expect(calls).toEqual([]);
  });

  test("parar o servidor fecha o gerenciador: um plugins.list em andamento não chama a CLI de novo", async () => {
    const { cli, calls, release } = gated();
    const { board, manager } = newBoard();
    const server = startServer({
      manager,
      board,
      plugins: new Plugins({ cli, pins: NONE }),
      features: undefined,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    const client = new FrameClient(server.url);
    stops.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    void client.request("plugins.list", {}).catch(() => {});
    await until(() => calls.length === 1);
    await server.stop();
    release();
    await Bun.sleep(100);
    expect(calls.map((c) => c[0])).toEqual(["list"]);
  });
});
