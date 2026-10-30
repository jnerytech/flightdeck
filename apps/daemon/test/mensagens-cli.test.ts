import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, runCli } from "../src/main.ts";
import { Idle } from "../src/messaging/idle.ts";
import { startServer } from "../src/server.ts";
import { newManager, tempDir } from "./helpers.ts";
import { setup } from "./mensagens-helpers.ts";

setDefaultTimeout(20_000);

const TOKEN = "msg-cli-token-0123456789abcdef";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function boot() {
  const base = setup();
  const idle = new Idle({
    endpoints: base.endpoints,
    messaging: base.messaging,
    host: "pc",
    clock: () => base.now.at,
  });
  const { manager } = newManager();
  const server = startServer({
    manager,
    messaging: base.messaging,
    idle,
    hostName: "pc",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
  });
  cleanups.push(() => {
    server.stop();
    idle.stop();
    base.messaging.stop();
  });
  base.endpoints.add("s1", { name: "coordenadora" });
  base.endpoints.add("s2", { name: "executora", state: "running" });
  const file = join(tempDir(), "config.json");
  writeFileSync(
    file,
    JSON.stringify({ token: TOKEN, port: server.port, dataDir: join(tempDir(), "data") }),
  );
  const run = async (
    args: string[],
    env: Record<string, string> = { FLIGHTDECK_SESSION: "s1" },
  ) => {
    const out: string[] = [];
    const errors: string[] = [];
    const exits: number[] = [];
    await runCli(["message", ...args, "--config", file], {
      env,
      log: { log: (m) => out.push(m), error: (m) => errors.push(m) },
      exit: (code) => exits.push(code),
      onSignal: () => {},
    });
    return { out: out.join("\n"), errors: errors.join("\n"), exits };
  };
  return { ...base, run };
}

describe("mcp-mensagens: flightdeckd message", () => {
  test("parseArgs: as cinco ações e o que cada uma pede", () => {
    expect(parseArgs(["message", "list"])).toMatchObject({ command: "message", action: "list" });
    expect(parseArgs(["message", "send", "pc/s2", "oi tudo bem"])).toMatchObject({
      action: "send",
      to: "pc/s2",
      text: "oi tudo bem",
    });
    expect(parseArgs(["message", "idle", "pc/s2"])).toMatchObject({
      action: "idle",
      session: "pc/s2",
    });
    expect(parseArgs(["message", "read", "pc/s2", "--last", "5"])).toMatchObject({
      action: "read",
      session: "pc/s2",
      last: 5,
    });
    expect(parseArgs(["message", "team", "t1"])).toMatchObject({ action: "team", team: "t1" });
    expect(() => parseArgs(["message", "apagar"])).toThrow("ação");
    expect(() => parseArgs(["message", "send", "pc/s2"])).toThrow("texto");
    expect(() => parseArgs(["message", "idle"])).toThrow("sessão");
    expect(() => parseArgs(["message", "team"])).toThrow("time");
    expect(() => parseArgs(["message", "read", "pc/s2", "--last", "muitas"])).toThrow("--last");
  });

  test("list, send, idle e read imprimem o mesmo JSON do MCP", async () => {
    const { run, endpoints } = boot();
    const listed = JSON.parse((await run(["list"])).out) as {
      sessions: Array<{ address: string }>;
    };
    expect(listed.sessions.map((s) => s.address)).toEqual(["pc/s2"]);
    endpoints.busy.add("s2");
    expect(JSON.parse((await run(["send", "pc/s2", "oi"])).out)).toMatchObject({
      resultado: "na fila",
    });
    expect(JSON.parse((await run(["idle", "pc/s2"])).out)).toEqual({ avisado: false });
    endpoints.transcripts.set("s2", {
      summary: null,
      messages: [{ role: "assistant", text: "feito" }],
    });
    expect(JSON.parse((await run(["read", "pc/s2", "--last", "1"])).out)).toMatchObject({
      messages: [{ text: "feito" }],
    });
    // The terminal is told apart by its launch.
    endpoints.add("T1", { kind: "terminal" });
    endpoints.launches.set("launch-1", "T1");
    const fromTerminal = await run(["send", "pc/s2", "do terminal"], {
      FLIGHTDECK_LAUNCH_ID: "launch-1",
    });
    expect(JSON.parse(fromTerminal.out)).toMatchObject({ resultado: "na fila" });
  });

  test("sem identidade, sem daemon ou com erro do daemon o comando falha com exit 1 e o motivo", async () => {
    const { run } = boot();
    const anonymous = await run(["list"], {});
    expect(anonymous.exits).toEqual([1]);
    expect(anonymous.errors).toContain("FLIGHTDECK_SESSION");
    const refused = await run(["idle", "pc/fantasma"]);
    expect(refused.exits).toEqual([1]);
    expect(refused.errors).toContain("not_found");
    // Teams are not on this daemon.
    const team = await run(["team", "t1"]);
    expect(team.exits).toEqual([1]);
    expect(team.errors).toContain("times indisponíveis");
    const dead = join(tempDir(), "config.json");
    writeFileSync(
      dead,
      JSON.stringify({ token: TOKEN, port: 1, dataDir: join(tempDir(), "data") }),
    );
    const errors: string[] = [];
    const exits: number[] = [];
    await runCli(["message", "list", "--config", dead], {
      env: { FLIGHTDECK_SESSION: "s1" },
      log: { log: () => {}, error: (m) => errors.push(m) },
      exit: (code) => exits.push(code),
      onSignal: () => {},
    });
    expect(exits).toEqual([1]);
    expect(errors.join(" ")).toContain("não consegui conectar no daemon");
  });
});
