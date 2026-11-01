import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AskpassRequest } from "@flightdeck/protocol";
import { runCli } from "../src/main.ts";
import { startServer } from "../src/server.ts";
import { AskpassBroker, askpassHook, writeAskpassScript } from "../src/ssh/askpass.ts";
import { SshTargets } from "../src/ssh/targets.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, poll, tempDir, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { manualTime } from "./time-helpers.ts";

const TOKEN = "askpass-token-0123456789abcdef0123";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const SECRET = "hunter2-SENHA-DE-TESTE";

function setup() {
  const time = manualTime();
  const broker = new AskpassBroker({ timers: time.timers, now: time.now });
  const targets = new SshTargets({ db: new EventStore(":memory:").db });
  const target = targets.save({
    name: "vps",
    host: "vps.example.com",
    user: "deploy",
    auth: "password",
    secretRef: "senha-da-vps",
  });
  const frames: AskpassRequest[] = [];
  const stop = broker.watch((frame) => frames.push(frame));
  return { time, broker, target, frames, stop };
}

const reasonOf = async (promise: Promise<unknown>): Promise<string | undefined> => {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { reason?: string }).reason;
  }
};

const code = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
};

describe("askpass: o corretor de pedidos", () => {
  test("o pedido vai para o app com o destino, o tipo e a referência do cofre; a resposta volta e a senha não fica em lugar nenhum", async () => {
    const { broker, target, frames } = setup();
    const ticket = broker.issue(target, "password");
    expect(ticket).toMatch(/^[0-9a-f]{32}$/);
    const pending = broker.ask(ticket, "deploy@vps.example.com's password: ");
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      type: "askpass.request",
      targetId: target.id,
      targetName: "vps",
      kind: "password",
      secretRef: "senha-da-vps",
      prompt: "deploy@vps.example.com's password: ",
    });
    broker.answer(frames[0]?.requestId ?? "", SECRET);
    expect(await pending).toBe(SECRET);
    // Neither the frames, the ticket nor the broker itself keep the answer.
    expect(JSON.stringify(frames)).not.toContain(SECRET);
    expect(JSON.stringify(broker)).not.toContain(SECRET);
    expect(ticket).not.toContain(SECRET);
  });

  test("sem ninguém para responder, falha na hora; um ticket desconhecido, vencido ou gasto é recusado", async () => {
    const { broker, target, frames, stop, time } = setup();
    const ticket = broker.issue(target, "passphrase");
    stop();
    expect(await code(broker.ask(ticket, "p"))).toBe("invalid_state");
    expect(await reasonOf(broker.ask(ticket, "p"))).toBe("ssh_askpass_no_app");
    expect(await code(broker.ask("0".repeat(32), "p"))).toBe("unauthorized");
    expect(await reasonOf(broker.ask("0".repeat(32), "p"))).toBe("ssh_askpass_ticket_invalid");
    // Back with someone listening, the same ticket still works: it asked no one.
    broker.watch((frame) => broker.answer(frame.requestId, SECRET));
    expect(await broker.ask(ticket, "Enter passphrase for key: ")).toBe(SECRET);
    expect(frames).toHaveLength(0);
    // Five uses at most (a wrong password is asked again), then a new ticket is needed.
    for (let i = 0; i < 4; i++) expect(await broker.ask(ticket, "again")).toBe(SECRET);
    expect(await code(broker.ask(ticket, "again"))).toBe("unauthorized");
    // A ticket expires after ten minutes.
    const old = broker.issue(target, "password");
    time.advance(10 * 60_000 + 1);
    expect(await code(broker.ask(old, "p"))).toBe("unauthorized");
  });

  test("o app pode recusar, ninguém responder em 120 s encerra o pedido, e uma resposta que sobra é not_found", async () => {
    const { broker, target, frames, time } = setup();
    const ticket = broker.issue(target, "password");
    const refused = broker.ask(ticket, "p");
    broker.answer(frames[0]?.requestId ?? "", null);
    expect(await code(refused)).toBe("invalid_state");
    expect(await reasonOf(refused)).toBe("ssh_askpass_cancelled");
    const silent = broker.ask(ticket, "p");
    time.advance(119_000);
    expect(frames).toHaveLength(2);
    time.advance(1_000);
    expect(await code(silent)).toBe("invalid_state");
    expect(await reasonOf(silent)).toBe("ssh_askpass_timeout");
    // The answer came too late; and one that was never asked is just as unknown.
    expect(() => broker.answer(frames[1]?.requestId ?? "", SECRET)).toThrow(/request not found/);
    expect(() => broker.answer("nada", SECRET)).toThrow(/request not found/);
    // An answered request cannot be answered twice.
    const again = broker.ask(ticket, "p");
    broker.answer(frames[2]?.requestId ?? "", SECRET);
    await again;
    expect(() => broker.answer(frames[2]?.requestId ?? "", "outra")).toThrow(/request not found/);
  });

  test("todo app que acompanha recebe o pedido, a primeira resposta vale e quem parou de acompanhar não recebe mais", async () => {
    const { broker, target, frames, stop } = setup();
    const second: AskpassRequest[] = [];
    const stopSecond = broker.watch((frame) => second.push(frame));
    const ticket = broker.issue(target, "password");
    const pending = broker.ask(ticket, "p");
    expect([frames.length, second.length]).toEqual([1, 1]);
    broker.answer(second[0]?.requestId ?? "", SECRET);
    expect(await pending).toBe(SECRET);
    expect(() => broker.answer(frames[0]?.requestId ?? "", "outra")).toThrow(/request not found/);
    stopSecond();
    const next = broker.ask(ticket, "p");
    expect([frames.length, second.length]).toEqual([2, 1]);
    broker.answer(frames[1]?.requestId ?? "", SECRET);
    await next;
    stop();
  });
});

describe("askpass: o script do SSH_ASKPASS", () => {
  const self = ["/usr/bin/bun", "run", "/opt/it's here/bin.ts"];

  test("fora do Windows: um sh que chama flightdeckd askpass com o prompt, executável, sem segredo", () => {
    const dir = tempDir();
    const file = writeAskpassScript({ dir, platform: "linux", self });
    expect(file).toBe(join(dir, "askpass.sh"));
    expect(readFileSync(file, "utf8")).toBe(
      "#!/bin/sh\nexec '/usr/bin/bun' 'run' '/opt/it'\\''s here/bin.ts' askpass \"$@\"\n",
    );
    if (process.platform !== "win32") expect(statSync(file).mode & 0o111).not.toBe(0);
  });

  test("no Windows: um .cmd que repassa o prompt com %*; um caminho com % ou aspas não cabe", () => {
    const dir = tempDir();
    const file = writeAskpassScript({
      dir,
      platform: "win32",
      self: ["C:\\bun\\bun.exe", "run", "C:\\fd\\bin.ts"],
    });
    expect(file).toBe(join(dir, "askpass.cmd"));
    expect(readFileSync(file, "utf8")).toBe(
      '@echo off\r\n"C:\\bun\\bun.exe" "run" "C:\\fd\\bin.ts" askpass %*\r\n',
    );
    for (const bad of ["C:\\100%\\bun.exe", 'C:\\a"b\\bun.exe']) {
      expect(() => writeAskpassScript({ dir, platform: "win32", self: [bad] })).toThrow(/\.cmd/);
      try {
        writeAskpassScript({ dir, platform: "win32", self: [bad] });
      } catch (error) {
        expect((error as { reason?: string }).reason).toBe("ssh_askpass_cmd_path");
      }
    }
  });

  test("o gancho do conector: o script, o config do daemon e tickets do corretor; se o script não cabe, não há askpass", async () => {
    const { broker, target } = setup();
    const hook = askpassHook({
      broker,
      dir: tempDir(),
      platform: "linux",
      self,
      configFile: "/home/u/.flightdeck/config.json",
    });
    expect(hook?.script.endsWith("askpass.sh")).toBe(true);
    expect(hook?.configFile).toBe("/home/u/.flightdeck/config.json");
    const ticket = hook?.ticket(target, "password") ?? "";
    expect(ticket).toMatch(/^[0-9a-f]{32}$/);
    broker.watch((frame) => broker.answer(frame.requestId, SECRET));
    expect(await broker.ask(ticket, "p")).toBe(SECRET);
    const none = askpassHook({
      broker,
      dir: tempDir(),
      platform: "win32",
      self: ["C:\\100%\\bun.exe"],
      configFile: "x",
    });
    expect(none).toBeUndefined();
  });

  test("só reescreve quando muda", async () => {
    const dir = tempDir();
    const file = writeAskpassScript({ dir, platform: "linux", self });
    const mtime = statSync(file).mtimeMs;
    await Bun.sleep(5);
    expect(writeAskpassScript({ dir, platform: "linux", self })).toBe(file);
    expect(statSync(file).mtimeMs).toBe(mtime);
    writeAskpassScript({ dir, platform: "linux", self: ["/usr/bin/other"] });
    expect(readFileSync(file, "utf8")).toContain("'/usr/bin/other'");
  });
});

/** A daemon with the broker, a config for the helper, and an "app" that answers what is asked. */
async function daemon() {
  const dir = tempDir();
  const { root } = workspace();
  const broker = new AskpassBroker({});
  const targets = new SshTargets({ db: new EventStore(":memory:").db });
  const target = targets.save({
    name: "vps",
    host: "vps.example.com",
    user: "deploy",
    auth: "password",
    secretRef: "senha-da-vps",
  });
  const server = startServer({
    manager: newManager().manager,
    askpass: broker,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [root],
  });
  cleanups.push(() => server.stop());
  const file = join(dir, "config.json");
  writeFileSync(file, JSON.stringify({ token: TOKEN, port: server.port, dataDir: dir }));
  const app = new FrameClient(server.url);
  cleanups.push(() => app.close());
  await app.request("hello", { token: TOKEN, client: "app" });
  const helper = async (env: Record<string, string | undefined>, ...prompt: string[]) => {
    const out: string[] = [];
    const errors: string[] = [];
    const exit = { code: null as number | null };
    await runCli(["askpass", ...prompt], {
      env,
      log: { log: (m: string) => out.push(m), error: (m: string) => errors.push(m) },
      exit: (c) => {
        exit.code = c;
      },
      onSignal: () => {},
    });
    return { out, errors, exitCode: exit.code };
  };
  return { broker, target, app, file, helper };
}

describe("askpass: o helper flightdeckd askpass", () => {
  test("pede ao app pelo daemon e devolve a senha pelo stdout; o prompt vem dos argumentos e a senha nunca está no ambiente", async () => {
    const { broker, target, app, file, helper } = await daemon();
    await app.request("askpass.watch", {});
    const ticket = broker.issue(target, "password");
    const env = { FLIGHTDECK_CONFIG: file, FLIGHTDECK_ASKPASS_TICKET: ticket };
    const running = helper(env, "deploy@vps's", "password:");
    const frame = await poll(() => app.frames.find((f) => f.type === "askpass.request"), 10_000);
    expect(frame).toMatchObject({
      targetName: "vps",
      kind: "password",
      secretRef: "senha-da-vps",
      prompt: "deploy@vps's password:",
    });
    const ack = await app.request("askpass.answer", {
      requestId: (frame as { requestId: string }).requestId,
      secret: SECRET,
    });
    expect(ack.error).toBeUndefined();
    const result = await running;
    expect(result).toEqual({ out: [SECRET], errors: [], exitCode: 0 });
    expect(JSON.stringify(env)).not.toContain(SECRET);
  });

  test("falha rápido: sem app respondendo, sem ticket, ticket inválido, sem config, daemon fora do ar ou app recusando", async () => {
    const { broker, target, app, file, helper } = await daemon();
    const ticket = broker.issue(target, "password");
    const ok = { FLIGHTDECK_CONFIG: file, FLIGHTDECK_ASKPASS_TICKET: ticket };
    const failed = async (env: Record<string, string | undefined>) => {
      const started = performance.now();
      const result = await helper(env, "password:");
      expect(performance.now() - started).toBeLessThan(5_000);
      expect(result.out).toEqual([]);
      expect(result.exitCode).toBe(1);
      return result.errors.join("\n");
    };
    // Nobody is watching.
    expect(await failed(ok)).toMatch(/app/);
    expect(await failed({ FLIGHTDECK_CONFIG: file })).toMatch(/ticket/);
    expect(await failed({ ...ok, FLIGHTDECK_ASKPASS_TICKET: "0".repeat(32) })).toMatch(
      /unauthorized/,
    );
    expect(await failed({ ...ok, FLIGHTDECK_CONFIG: join(tempDir(), "nao-existe.json") })).toMatch(
      /config/,
    );
    const down = join(tempDir(), "config.json");
    writeFileSync(down, JSON.stringify({ token: TOKEN, port: 1, dataDir: tempDir() }));
    expect(await failed({ ...ok, FLIGHTDECK_CONFIG: down })).toMatch(/daemon/);
    // The app refuses.
    await app.request("askpass.watch", {});
    const running = failed(ok);
    const frame = await poll(() => app.frames.find((f) => f.type === "askpass.request"), 10_000);
    await app.request("askpass.answer", {
      requestId: (frame as { requestId: string }).requestId,
      secret: null,
    });
    expect(await running).toMatch(/cancel/);
  });

  test("sem o corretor configurado, os comandos askpass dizem que está desativado", async () => {
    const { root } = workspace();
    const server = startServer({
      manager: newManager().manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    for (const [type, payload] of [
      ["askpass.watch", {}],
      ["askpass.ask", { ticket: "x", prompt: "p" }],
      ["askpass.answer", { requestId: "x", secret: null }],
    ] as const) {
      const ack = await client.request(type, payload);
      expect([type, (ack.error as { code?: string } | undefined)?.code]).toEqual([
        type,
        "invalid_state",
      ]);
    }
  });
});
