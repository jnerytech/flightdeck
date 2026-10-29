import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { statuslineText } from "../src/costs/statusline.ts";
import { runCli, startDaemon } from "../src/main.ts";
import { tempDir, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { SESSION } from "./usage-helpers.ts";

setDefaultTimeout(20_000);

const TOKEN = "statusline-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** Claude Code's JSON on stdin, as a stream; `open` keeps it from ever ending. */
function stdinOf(json: unknown, open = false): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(json)));
      if (!open) controller.close();
    },
  });
}

/** `flightdeckd statusline` in this process, timed. */
async function statusline(args: string[], stdin: ReadableStream<Uint8Array>) {
  const out: string[] = [];
  const codes: number[] = [];
  const start = performance.now();
  await runCli(["statusline", ...args], {
    env: {},
    log: { log: (m) => out.push(m), error: (m) => out.push(`erro: ${m}`) },
    exit: (code) => codes.push(code),
    onSignal: () => {},
    stdin,
  });
  return { out, codes, ms: performance.now() - start };
}

function config(dir: string, port: number) {
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({ port, token: TOKEN, bind: "127.0.0.1", dataDir: join(dir, "data") }),
  );
  return file;
}

describe("statusline", () => {
  test("a linha: janelas da cota, custo de hoje e da sessão", () => {
    const windows = [
      { window: "five_hour", utilization: 0.35 },
      { window: "seven_day", utilization: 0.27 },
    ];
    expect(statuslineText({ windows, todayUsd: 4.2, sessionUsd: 0.84 })).toBe(
      "5h 35% · 7d 27% · hoje $4.20 · sessão $0.84",
    );
    expect(statuslineText({ windows: [], todayUsd: 0, sessionUsd: null })).toBe("hoje $0.00");
    expect(
      statuslineText({
        windows: [{ window: "five_hour", utilization: null }],
        todayUsd: 1,
        sessionUsd: null,
      }),
    ).toBe("hoje $1.00");
  });

  test("com o daemon: a cota das sessões e o custo dos transcripts de hoje", async () => {
    const dir = tempDir();
    const { root, project } = workspace();
    const projects = join(dir, "projects");
    mkdirSync(join(projects, "proj", SESSION, "subagents"), { recursive: true });
    const now = new Date().toISOString();
    const fixture = (name: string) =>
      readFileSync(join(import.meta.dir, "fixtures", "history", name), "utf8")
        .replaceAll("__CWD__", "/work/app")
        .replace(/"timestamp":"[^"]+"/g, `"timestamp":"${now}"`);
    writeFileSync(join(projects, "proj", `${SESSION}.jsonl`), fixture("usage-main.jsonl"));
    writeFileSync(
      join(projects, "proj", SESSION, "subagents", "agent-1.jsonl"),
      fixture("usage-subagent.jsonl"),
    );
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        port: 0,
        token: TOKEN,
        dataDir: join(dir, "data"),
        allowedRoots: [root],
        history: { roots: [projects] },
      }),
    );
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
    );
    cleanups.push(() => daemon.stop());
    const port = Number(new URL(daemon.url).port);
    const client = new FrameClient(daemon.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const epoch = Math.floor(Date.now() / 1000) + 3600;
    await client.request("session.create", {
      cwd: project,
      prompt: `[ratelimit:five_hour=0.35@${epoch}] [ratelimit:seven_day=0.27@${epoch}]`,
    });
    const data = async () =>
      client.data<{ windows: unknown[]; todayUsd: number; sessionUsd: number | null }>(
        "statusline.get",
        { claudeSessionId: SESSION },
      );
    let got: Awaited<ReturnType<typeof data>> = null;
    for (let i = 0; i < 100 && (got?.windows.length !== 2 || got.sessionUsd === null); i++) {
      got = await data();
      if (got?.windows.length !== 2 || got.sessionUsd === null) await Bun.sleep(30);
    }
    expect(got?.windows).toEqual([
      { window: "five_hour", utilization: 0.35 },
      { window: "seven_day", utilization: 0.27 },
    ]);
    // The fixtures cost US$ 0.00589.
    expect(got?.todayUsd.toFixed(5)).toBe("0.00589");
    const viaCli = await statusline(
      ["--config", config(tempDir(), port)],
      stdinOf({ session_id: SESSION, cwd: "/work/app" }),
    );
    expect(viaCli.out).toEqual(["5h 35% · 7d 27% · hoje $0.01 · sessão $0.01"]);
    expect(viaCli.codes).toEqual([0]);
  });

  test("daemon fora do ar, mudo ou stdin que não termina: linha vazia e saída 0 em menos de 300 ms", async () => {
    const closed = Bun.serve({ port: 0, fetch: () => new Response("") });
    const freePort = closed.port as number;
    closed.stop(true);
    const silent = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("", { status: 426 })),
      websocket: { message() {} },
    });
    cleanups.push(() => silent.stop(true));
    const input = { session_id: SESSION, cwd: "/work/app" };
    for (const [port, stdin] of [
      [freePort, stdinOf(input)],
      [silent.port as number, stdinOf(input)],
      [silent.port as number, stdinOf(input, true)],
    ] as const) {
      const result = await statusline(["--config", config(tempDir(), port)], stdin);
      expect([result.out, result.codes]).toEqual([[""], [0]]);
      // The criterion itself: out in under 300 ms. The command's own deadline is 250 ms, which
      // leaves the 50 ms that starting the work and printing the line take.
      expect(result.ms).toBeLessThan(300);
    }
  });

  test("sem config: linha vazia, e nada é escrito (nem a config nem settings do Claude Code)", async () => {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    const settings = join(home, ".claude", "settings.json");
    const before = existsSync(settings) ? readFileSync(settings, "utf8") : null;
    const missing = join(tempDir(), "nao-existe.json");
    const result = await statusline(["--config", missing], stdinOf({ session_id: SESSION }));
    expect([result.out, result.codes]).toEqual([[""], [0]]);
    expect(existsSync(missing)).toBe(false);
    expect(existsSync(settings) ? readFileSync(settings, "utf8") : null).toBe(before);
  });
});
