import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Config } from "../src/config.ts";
import { runCli } from "../src/main.ts";
import { startServer } from "../src/server.ts";
import { UpdateChecker } from "../src/updates/check.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { manualTime } from "./time-helpers.ts";

const TOKEN = "update-check-token-0123456789";
const HOUR = 3_600_000;

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const manifest = (version: string) => ({
  version,
  protocol: 1,
  assets: {
    "linux-x64": { url: "http://127.0.0.1/x", sha256: "a".repeat(64), signature: "s" },
  },
});

/** A local release server whose `daemon-latest.json` the test can change. */
function releaseServer(initial: unknown) {
  const state = { body: JSON.stringify(initial), status: 200, hits: 0 };
  const server = Bun.serve({
    port: 0,
    fetch: () => {
      state.hits++;
      return new Response(state.body, { status: state.status });
    },
  });
  cleanups.push(() => server.stop(true));
  return { url: `http://127.0.0.1:${server.port}/daemon-latest.json`, state };
}

function checker(url: string, currentVersion = "0.8.0") {
  const time = manualTime(Date.parse("2026-11-02T10:00:00.000Z"));
  const updates = new UpdateChecker({
    manifestUrl: url,
    checkIntervalH: 24,
    currentVersion,
    now: time.now,
    timers: time.timers,
  });
  cleanups.push(() => updates.stop());
  return { updates, time };
}

describe("daemon-update-check", () => {
  test("config: a cada 24 h; rodando do código-fonte não há manifesto padrão", () => {
    expect(Config.parse({}).updates).toEqual({ manifestUrl: null, checkIntervalH: 24 });
    expect(
      Config.parse({ updates: { manifestUrl: "http://127.0.0.1:9/m.json", checkIntervalH: 6 } })
        .updates,
    ).toEqual({ manifestUrl: "http://127.0.0.1:9/m.json", checkIntervalH: 6 });
    expect(() => Config.parse({ updates: { checkIntervalH: 0 } })).toThrow();
  });

  test("baixa o manifesto ao subir e de novo a cada intervalo, comparando com a própria versão", async () => {
    const release = releaseServer(manifest("0.9.0"));
    const { updates, time } = checker(release.url);
    expect(updates.status()).toBeNull();
    await updates.start();
    expect(updates.status()).toEqual({
      available: true,
      version: "0.9.0",
      checkedAt: "2026-11-02T10:00:00.000Z",
    });
    release.state.body = JSON.stringify(manifest("0.9.1"));
    time.advance(23 * HOUR);
    await Bun.sleep(20);
    expect(release.state.hits).toBe(1);
    time.advance(HOUR);
    await Bun.sleep(20);
    expect(release.state.hits).toBe(2);
    expect(updates.status()).toMatchObject({ available: true, version: "0.9.1" });
  });

  test("mesma versão ou mais antiga não é atualização", async () => {
    const same = checker(releaseServer(manifest("0.8.0")).url);
    await same.updates.start();
    expect(same.updates.status()).toMatchObject({ available: false, version: "0.8.0" });
    const older = checker(releaseServer(manifest("0.7.5")).url);
    await older.updates.start();
    expect(older.updates.status()?.available).toBe(false);
  });

  test("manifesto inválido, HTTP de erro ou servidor fora do ar viram erro, sem derrubar o daemon", async () => {
    const release = releaseServer({ version: "nove" });
    const { updates, time } = checker(release.url);
    await updates.start();
    expect(updates.status()).toMatchObject({ available: false, version: null });
    expect(updates.status()?.error).toStartWith("manifesto inválido");
    release.state.status = 404;
    release.state.body = "não achei";
    time.advance(24 * HOUR);
    await Bun.sleep(20);
    expect(updates.status()?.error).toBe("o servidor respondeu HTTP 404");
    const down = checker("http://127.0.0.1:9/daemon-latest.json");
    await down.updates.start();
    expect(down.updates.status()?.error).toStartWith("não consegui baixar o manifesto");
  });

  test("host.info traz o update quando o daemon verifica; sem verificação, não traz", async () => {
    const release = releaseServer(manifest("0.9.0"));
    const { updates } = checker(release.url);
    await updates.start();
    const { manager } = newManager();
    const base = { manager, hostName: "h", bind: "127.0.0.1", port: 0, token: TOKEN };
    const server = startServer({ ...base, allowedRoots: [], updates });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    expect((await client.data<{ update?: unknown }>("host.info", {}))?.update).toEqual(
      updates.status(),
    );
    const plain = startServer({ ...base, allowedRoots: [] });
    cleanups.push(() => plain.stop());
    const other = new FrameClient(plain.url);
    cleanups.push(() => other.close());
    await other.request("hello", { token: TOKEN, client: "t" });
    expect((await other.data<{ update?: unknown }>("host.info", {}))?.update).toBeUndefined();
  });

  test("flightdeckd start verifica o manifesto da config ao subir", async () => {
    const release = releaseServer(manifest("9.0.0"));
    const dir = tempDir();
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        port: 0,
        token: TOKEN,
        dataDir: join(dir, "data"),
        hooks: { port: 0 },
        updates: { manifestUrl: release.url },
      }),
    );
    const daemon = await runCli(["--config", file, "--runtime", "fake"], {
      env: {},
      log: { log: () => {}, error: () => {} },
      exit: () => {},
      onSignal: () => {},
    });
    cleanups.push(() => daemon?.stop());
    const client = new FrameClient(daemon?.url ?? "");
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const deadline = Date.now() + 3000;
    let update: { available?: boolean } | undefined;
    while (!update?.available && Date.now() < deadline) {
      update = (await client.data<{ update?: { available: boolean } }>("host.info", {}))?.update;
      if (!update?.available) await Bun.sleep(20);
    }
    expect(update).toMatchObject({ available: true, version: "9.0.0" });
  });
});
