import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../../src/main.ts";
import { startServer } from "../../src/server.ts";
import { AskpassBroker } from "../../src/ssh/askpass.ts";
import { SshTargets } from "../../src/ssh/targets.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { newManager, poll, tempDir, workspace } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

const TOKEN = "askpass-token-0123456789abcdef0123";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const SECRET = "hunter2-SENHA-DE-TESTE";

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
    ssh: { askpass: broker },
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
    expect(await failed({ FLIGHTDECK_CONFIG: file })).toMatch(/no askpass ticket/);
    expect(await failed({ ...ok, FLIGHTDECK_ASKPASS_TICKET: "0".repeat(32) })).toMatch(
      /unauthorized/,
    );
    expect(await failed({ ...ok, FLIGHTDECK_CONFIG: join(tempDir(), "nao-existe.json") })).toMatch(
      /no Flightdeck config/,
    );
    const down = join(tempDir(), "config.json");
    writeFileSync(down, JSON.stringify({ token: TOKEN, port: 1, dataDir: tempDir() }));
    expect(await failed({ ...ok, FLIGHTDECK_CONFIG: down })).toMatch(/could not reach the daemon/);
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
