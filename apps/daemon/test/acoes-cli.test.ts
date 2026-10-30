import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Actions } from "../src/actions/actions.ts";
import { parseArgs, runCli } from "../src/main.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { Vault } from "../src/vault/vault.ts";
import { gitRepo } from "./board-helpers.ts";
import { newManager, poll, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(20_000);

const TOKEN = "acoes-cli-token-0123456789abcdef";
const VALUE = "tok_SEGREDO-DE-TESTE-7d2f9a";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const sayDef = {
  name: "diz",
  description: "diz uma palavra",
  run: [process.execPath, "-e", "console.log(process.argv[1])", "{{param.palavra}}"],
  params: { palavra: { pattern: "^[a-z]{1,8}$", default: "oi" } },
};
const echoDef = {
  name: "echo",
  description: "imprime o token",
  run: [process.execPath, "-e", "console.log(process.env.TOKEN)"],
  env: { TOKEN: "{{secret.token}}" },
};

async function setup() {
  const { manager } = newManager();
  const { repo } = gitRepo();
  const store = new EventStore(":memory:");
  const vault = new Vault({ log: () => {} });
  const actions = new Actions({
    db: store.db,
    vault,
    hostBase: tempDir("fd-host-"),
    requestTimeoutMs: 3000,
    projects: () => ({ id: "p1", path: repo, baseBranch: "main" }),
  });
  const server = startServer({
    manager,
    vault,
    actions,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
  });
  cleanups.push(() => {
    server.stop();
    actions.stop();
    vault.stop();
  });
  await actions.save({ projectId: "p1", definition: sayDef });
  await actions.save({ projectId: "p1", definition: echoDef });
  const app = new FrameClient(server.url);
  cleanups.push(() => app.close());
  await app.request("hello", { token: TOKEN, client: "app" });
  await app.request("vault.watch", {});
  const file = join(tempDir(), "config.json");
  writeFileSync(
    file,
    JSON.stringify({ token: TOKEN, port: server.port, dataDir: join(tempDir(), "data") }),
  );
  const run = async (...args: string[]) => {
    const out: string[] = [];
    const errors: string[] = [];
    const exits: number[] = [];
    await runCli([...args, "--config", file], {
      env: {},
      log: { log: (m) => out.push(m), error: (m) => errors.push(m) },
      exit: (code) => exits.push(code),
      onSignal: () => {},
    });
    return { out: out.join("\n"), errors: errors.join("\n"), exits };
  };
  return { run, app };
}

describe("acoes-cli", () => {
  test("parseArgs: action list e action run com --project e --param", () => {
    expect(parseArgs(["action", "list", "--project", "p1"])).toMatchObject({
      command: "action",
      action: "list",
      project: "p1",
    });
    expect(
      parseArgs(["action", "run", "diz", "--param", "palavra=ola", "--param", "x=a=b"]),
    ).toMatchObject({
      command: "action",
      action: "run",
      actionName: "diz",
      params: { palavra: "ola", x: "a=b" },
    });
    expect(() => parseArgs(["action", "apagar"])).toThrow("ação");
    expect(() => parseArgs(["action", "run"])).toThrow("nome");
    expect(() => parseArgs(["action", "run", "diz", "--param", "sem-igual"])).toThrow("--param");
  });

  test("action list imprime o JSON das ações confiadas, sem segredos", async () => {
    const { run } = await setup();
    const listed = await run("action", "list", "--project", "p1");
    expect(listed.exits).toEqual([0]);
    const parsed = JSON.parse(listed.out) as { actions: Array<{ name: string }> };
    expect(parsed.actions.map((a) => a.name)).toEqual(["diz", "echo"]);
    expect(listed.out).not.toContain("TOKEN");
    expect(listed.out).not.toContain('"secrets"');
  });

  test("action run roda pelo daemon como claude e imprime o resultado", async () => {
    const { run } = await setup();
    const said = await run("action", "run", "diz", "--project", "p1", "--param", "palavra=ola");
    expect(said.exits).toEqual([0]);
    expect(JSON.parse(said.out)).toMatchObject({ exitCode: 0, output: "ola\n" });
  });

  test("action run com segredo espera o app, e o valor não aparece no que é impresso", async () => {
    const { run, app } = await setup();
    const running = run("action", "run", "echo", "--project", "p1");
    const frame = (await poll(() => app.frames.find((f) => f.type === "vault.request"))) as {
      secretId: string;
      purpose: string;
      requester: string;
    };
    expect(frame.requester).toBe("claude");
    await app.request("vault.deliver", {
      secretId: frame.secretId,
      value: VALUE,
      purpose: frame.purpose,
      expiresAt: Date.now() + 30_000,
      requester: "claude",
    });
    const done = await running;
    expect(JSON.parse(done.out)).toMatchObject({ output: "•••(token)\n" });
    expect(done.out).not.toContain(VALUE);
  });

  test("sem daemon no ar o comando diz que não conseguiu conectar", async () => {
    const dead = join(tempDir(), "config.json");
    writeFileSync(
      dead,
      JSON.stringify({ token: TOKEN, port: 1, dataDir: join(tempDir(), "data") }),
    );
    const errors: string[] = [];
    const exits: number[] = [];
    await runCli(["action", "list", "--config", dead], {
      env: {},
      log: { log: () => {}, error: (m) => errors.push(m) },
      exit: (code) => exits.push(code),
      onSignal: () => {},
    });
    expect(exits).toEqual([1]);
    expect(errors.join(" ")).toContain("não consegui conectar no daemon");
  });

  test("um erro do daemon vira erro do comando, com o código e a mensagem", async () => {
    const { run } = await setup();
    const refused = await run("action", "run", "diz", "--project", "p1", "--param", "palavra=NÃO");
    expect(refused.exits).toEqual([1]);
    expect(refused.errors).toContain("bad_request");
    const missing = await run("action", "run", "nada", "--project", "p1");
    expect(missing.exits).toEqual([1]);
    expect(missing.errors).toContain("not_found");
  });
});
