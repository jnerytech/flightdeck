import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { PersonaInput } from "@flightdeck/protocol";
import { ExternalSessions } from "../src/central/external.ts";
import { type Receptor, startReceptor } from "../src/central/receptor.ts";
import { RECEPTOR_FILE } from "../src/central/wrapper.ts";
import { runCli } from "../src/main.ts";
import { packPersonas } from "../src/personas/pack.ts";
import { Personas } from "../src/personas/store.ts";
import { ClaudeSdkRuntime, type QueryFn } from "../src/runtime/claude-sdk-runtime.ts";
import { startServer } from "../src/server.ts";
import { SessionManager } from "../src/sessions/session-manager.ts";
import { SecretScanner } from "../src/snippets/model.ts";
import { EventStore } from "../src/store/event-store.ts";
import { installFakeClaude } from "./fake-claude.ts";
import { newManager, poll, record, tempDir, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

// Real processes (flightdeckd, the fake claude): more than the default 5 s.
setDefaultTimeout(40_000);

const TOKEN = "t".repeat(32);
const HOOKS = "hooks-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const scanner = new SecretScanner();

const REVIEWER: PersonaInput = {
  id: "revisor-host",
  name: "Revisor do host",
  description: "Revisa",
  model: "claude-opus-5-5",
  effort: "high",
  tools: ["Read", "Grep"],
  permissionMode: "plan",
  body: "Você atua como revisor. Não altere código.",
};

function codeOf(fn: () => unknown): Promise<string> | string {
  try {
    const out = fn();
    return out instanceof Promise
      ? out.then(
          () => "ok",
          (error: { code?: string }) => error.code ?? "sem código",
        )
      : "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
}

function setup(options: { personas?: boolean } = {}) {
  const { root, project } = workspace();
  const store = new EventStore(":memory:");
  const personas = new Personas({
    db: store.db,
    allowedRoots: [root],
    scanner,
    pack: packPersonas,
  });
  personas.save({ scope: "host", persona: REVIEWER });
  const made = newManager({
    store,
    allowedRoots: [root],
    ...(options.personas === false ? {} : { personas }),
  });
  cleanups.push(() => made.manager.shutdown());
  return { ...made, root, project, personas, store };
}

describe("personas-sessao-nova: gerenciada", () => {
  test("a persona vira instruções acrescentadas, modelo, esforço e ferramentas pelo runtime, e o modo nunca passa do pedido", () => {
    const { manager, runtime, project } = setup();
    const { sessionId } = manager.create({
      cwd: project,
      prompt: "revise",
      persona: { id: "revisor-host" },
    });
    expect(runtime.starts).toHaveLength(1);
    expect(runtime.starts[0]).toMatchObject({
      cwd: project,
      model: "claude-opus-5-5",
      // plan is less permissive than the default the session asked for: the suggestion applies.
      permissionMode: "plan",
      persona: {
        append: "Você atua como revisor. Não altere código.",
        effort: "high",
        tools: ["Read", "Grep"],
      },
    });
    expect(manager.get(sessionId)).toMatchObject({
      model: "claude-opus-5-5",
      permissionMode: "plan",
      persona: { id: "revisor-host", name: "Revisor do host", icon: null },
    });
  });

  test("o pedido manda: modelo e modo explícitos valem, e uma persona mais permissiva não afrouxa o modo", () => {
    const { manager, runtime, project, personas } = setup();
    personas.save({
      scope: "host",
      persona: {
        ...REVIEWER,
        id: "solta",
        permissionMode: "acceptEdits",
        model: "claude-opus-5-5",
      },
    });
    manager.create({
      cwd: project,
      prompt: "oi",
      persona: { id: "solta" },
      permissionMode: "default",
      model: "claude-sonnet-5-5",
    });
    expect(runtime.starts[0]).toMatchObject({
      model: "claude-sonnet-5-5",
      permissionMode: "default",
    });
    manager.create({
      cwd: project,
      prompt: "oi",
      persona: { id: "solta" },
      permissionMode: "plan",
    });
    expect(runtime.starts[1]?.permissionMode).toBe("plan");
  });

  test("uma persona do app vai inteira, e as regras valem do mesmo jeito", async () => {
    const { manager, runtime, project } = setup();
    manager.create({
      cwd: project,
      prompt: "oi",
      persona: {
        definition: { id: "do-app", name: "Do app", description: "d", body: "Corpo do app." },
      },
    });
    expect(runtime.starts[0]?.persona).toMatchObject({ append: "Corpo do app." });
    const secret = `ghp_${"0123456789abcdef".repeat(2)}0123`;
    expect(
      await codeOf(() =>
        manager.create({
          cwd: project,
          prompt: "oi",
          persona: { definition: { id: "ruim", name: "Ruim", description: "d", body: secret } },
        }),
      ),
    ).toBe("persona_secret");
    expect(manager.list()).toHaveLength(1);
  });

  test("uma persona do pacote vale no idioma pedido", () => {
    const { manager, runtime, project } = setup();
    manager.create({ cwd: project, prompt: "oi", persona: { id: "qa", language: "en" } });
    manager.create({ cwd: project, prompt: "oi", persona: { id: "qa" } });
    expect(runtime.starts[0]?.persona?.append).toMatch(/You act as a senior QA engineer/);
    expect(runtime.starts[1]?.persona?.append).toMatch(/engenheiro de QA sênior/);
    expect(runtime.starts[0]?.model).toBe("claude-sonnet-5-5");
  });

  test("falhas não deixam sessão: persona que não existe, versionada sem confiança, ou sem o cadastro de personas", async () => {
    const { manager, project } = setup();
    expect(
      await codeOf(() => manager.create({ cwd: project, prompt: "oi", persona: { id: "nada" } })),
    ).toBe("not_found");
    const dir = join(project, ".flightdeck", "personas");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "do-projeto.md"),
      "---\nid: do-projeto\nname: P\ndescription: d\n---\nCorpo.\n",
    );
    expect(
      await codeOf(() =>
        manager.create({ cwd: project, prompt: "oi", persona: { id: "do-projeto" } }),
      ),
    ).toBe("persona_untrusted");
    expect(manager.list()).toEqual([]);
    const bare = setup({ personas: false });
    expect(
      await codeOf(() =>
        bare.manager.create({ cwd: bare.project, prompt: "oi", persona: { id: "qa" } }),
      ),
    ).toBe("invalid_state");
    expect(bare.manager.list()).toEqual([]);
  });

  test("tools só restringe: uma ferramenta fora da lista é negada, uma da lista segue para a aprovação", async () => {
    const { manager, runtime, project } = setup();
    const { sessionId } = manager.create({
      cwd: project,
      prompt: "oi",
      persona: { id: "revisor-host" },
    });
    const canUseTool = runtime.starts[0]?.canUseTool;
    const ctx = { signal: new AbortController().signal };
    const denied = await canUseTool?.("Write", { file_path: "a.ts" }, ctx);
    expect(denied).toMatchObject({ behavior: "deny" });
    expect((denied as { message: string }).message).toMatch(/Revisor do host/);
    const mcp = await canUseTool?.("mcp__github__create_issue", {}, ctx);
    expect(mcp).toMatchObject({ behavior: "deny" });
    // A tool on the list is decided as usual: here it waits for the person.
    void canUseTool?.("Read", { file_path: "a.ts" }, ctx);
    const pending = await poll(() => manager.pendingPermissions(sessionId).length > 0);
    expect(pending).toBe(true);
    // And a session with no persona is not restricted at all.
    const plain = manager.create({ cwd: project, prompt: "oi" });
    void runtime.starts[1]?.canUseTool("Write", {}, ctx);
    expect(await poll(() => manager.pendingPermissions(plain.sessionId).length > 0)).toBe(true);
  });

  test("a persona acompanha a sessão: resumir, reabrir depois de reiniciar o daemon e o histórico mostram a mesma, mesmo se ela mudar depois", async () => {
    const { manager, runtime, project, personas, store, root } = setup();
    const { sessionId } = manager.create({
      cwd: project,
      prompt: "oi",
      persona: { id: "revisor-host" },
    });
    const events = record(manager, sessionId);
    expect(events.find("session.created")).toMatchObject({
      persona: { id: "revisor-host", name: "Revisor do host" },
    });
    await poll(() => events.statuses().includes("idle"));
    // The host edits the persona and then the session is closed and resumed.
    personas.save({ scope: "host", persona: { ...REVIEWER, body: "Outro corpo.", effort: "low" } });
    await manager.close(sessionId);
    await manager.resume(sessionId);
    expect(runtime.starts).toHaveLength(2);
    expect(runtime.starts[1]).toMatchObject({
      persona: {
        append: "Você atua como revisor. Não altere código.",
        effort: "high",
        tools: ["Read", "Grep"],
      },
      model: "claude-opus-5-5",
    });
    // A new daemon process over the same database reattaches lazily on the next message.
    await manager.shutdown();
    const second = new SessionManager({
      store,
      runtime,
      allowedRoots: [root],
      defaultPermissionMode: "default",
      allowApiKey: false,
      baseEnv: {},
      personas,
    });
    cleanups.push(() => second.shutdown());
    store.updateSession(sessionId, { status: "idle" });
    second.send(sessionId, "continue");
    expect(runtime.starts).toHaveLength(3);
    expect(runtime.starts[2]?.persona?.append).toBe("Você atua como revisor. Não altere código.");
  });
});

describe("personas-sessao-nova: o runtime do SDK", () => {
  function sdkOptions(persona?: { append: string; effort?: "high"; tools?: string[] | null }) {
    const seen: Options[] = [];
    const query: QueryFn = ({ options }) => {
      seen.push(options);
      return {
        async *[Symbol.asyncIterator]() {},
        interrupt: async () => {},
        close: () => {},
      };
    };
    const runtime = new ClaudeSdkRuntime({ query });
    runtime.start({
      cwd: "/work",
      permissionMode: "default",
      env: {},
      canUseTool: async () => ({ behavior: "deny", message: "x" }),
      ...(persona ? { persona } : {}),
    });
    return seen[0] as Options;
  }

  test("com persona: o preset do Claude Code com append, o esforço e as ferramentas como conjunto disponível, nunca allowedTools", () => {
    const options = sdkOptions({
      append: "Seja um revisor.",
      effort: "high",
      tools: ["Read", "Grep"],
    });
    expect(options.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "Seja um revisor.",
    });
    expect(options.effort).toBe("high");
    expect(options.tools).toEqual(["Read", "Grep"]);
    // allowedTools would pre-approve tools: a persona only ever restricts.
    expect("allowedTools" in options).toBe(false);
  });

  test("sem lista de ferramentas ou sem persona, nada muda no que já existia", () => {
    const noTools = sdkOptions({ append: "Texto.", tools: null });
    expect("tools" in noTools).toBe(false);
    expect("effort" in noTools).toBe(false);
    const plain = sdkOptions();
    expect(plain.systemPrompt).toEqual({ type: "preset", preset: "claude_code" });
    expect("tools" in plain).toBe(false);
    expect("effort" in plain).toBe(false);
  });
});

/** A config with the hooks token and a live receptor, like the daemon, and a daemon to ask. */
async function terminalHost(personas: Personas | null, root: string) {
  const dir = tempDir();
  const dataDir = join(dir, "data");
  mkdirSync(dataDir, { recursive: true });
  const external = new ExternalSessions({ db: new EventStore(":memory:").db, staleAfterS: 900 });
  const receptor: Receptor = startReceptor({
    port: 0,
    token: () => HOOKS,
    external,
    isManaged: () => false,
  });
  cleanups.push(() => receptor.stop());
  writeFileSync(join(dataDir, RECEPTOR_FILE), JSON.stringify({ url: receptor.url }));
  const server = startServer({
    manager: newManager().manager,
    ...(personas ? { personas } : {}),
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [root],
  });
  cleanups.push(() => server.stop());
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({ token: TOKEN, port: server.port, dataDir, hooks: { port: 0, token: HOOKS } }),
  );
  return { file, dataDir, server };
}

describe("personas-sessao-nova: o terminal, flightdeckd claude --persona", () => {
  async function run(args: string[], host: { file: string }, cwd?: string) {
    const errors: string[] = [];
    let code: number | null = null;
    await runCli(["claude", ...args], {
      env: { ...process.env, FLIGHTDECK_CONFIG: host.file },
      log: { log: () => {}, error: (message) => errors.push(message) },
      exit: (c) => {
        code = c;
      },
      onSignal: () => {},
      selfCommand: [process.execPath, "run", join(import.meta.dir, "..", "src", "bin.ts")],
      ...(cwd ? { cwd } : {}),
    });
    return { code, errors };
  }

  const startOf = (fake: ReturnType<typeof installFakeClaude>) =>
    fake.events().find((e) => e.type === "start") as unknown as {
      args: string[];
      appended: string | null;
      appendedPath: string | null;
    };

  test("grava o corpo num arquivo temporário, passa --append-system-prompt-file, --model e --effort, e apaga o arquivo no fim", async () => {
    const { root, project } = workspace();
    const personas = new Personas({
      db: new EventStore(":memory:").db,
      allowedRoots: [root],
      scanner,
      pack: packPersonas,
    });
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    const result = await run(["--persona", "qa", "--verbose"], host, project);
    expect(result.code).toBe(0);
    const start = startOf(fake);
    const args = start.args;
    expect(args).toContain("--append-system-prompt-file");
    expect(start.appended).toMatch(/engenheiro de QA sênior/);
    expect(args[args.indexOf("--model") + 1]).toBe("claude-sonnet-5-5");
    expect(args[args.indexOf("--effort") + 1]).toBe("medium");
    // The user's own arguments follow, untouched; --persona itself is not passed to claude.
    expect(args).toContain("--verbose");
    expect(args).not.toContain("--persona");
    // The file was there while claude ran and is gone when it ends.
    expect(start.appendedPath).not.toBeNull();
    expect(existsSync(start.appendedPath as string)).toBe(false);
  });

  test("ferramentas e modo plan vão junto; os argumentos do próprio usuário vencem", async () => {
    const { root, project } = workspace();
    const personas = new Personas({
      db: new EventStore(":memory:").db,
      allowedRoots: [root],
      scanner,
    });
    personas.save({ scope: "host", persona: REVIEWER });
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([
      { do: "exit", code: 0 },
      { do: "exit", code: 0 },
    ]);
    cleanups.push(fake.restore);
    await run(["--persona=revisor-host"], host, project);
    const first = startOf(fake).args;
    expect(first[first.indexOf("--tools") + 1]).toBe("Read,Grep");
    expect(first[first.indexOf("--permission-mode") + 1]).toBe("plan");
    expect(first[first.indexOf("--model") + 1]).toBe("claude-opus-5-5");
    expect(first).not.toContain("--allowedTools");
    expect(first).not.toContain("--allowed-tools");
  });

  test("o que o usuário passou não é repetido pela persona, e --persona fora do começo é do claude", async () => {
    const { root, project } = workspace();
    const personas = new Personas({
      db: new EventStore(":memory:").db,
      allowedRoots: [root],
      scanner,
    });
    personas.save({ scope: "host", persona: REVIEWER });
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    await run(
      [
        "--persona",
        "revisor-host",
        "--model",
        "sonnet",
        "--effort",
        "low",
        "--tools",
        "Bash",
        "--permission-mode",
        "acceptEdits",
      ],
      host,
      project,
    );
    const args = startOf(fake).args;
    for (const flag of ["--model", "--effort", "--tools", "--permission-mode"]) {
      expect([flag, args.filter((a) => a === flag).length]).toEqual([flag, 1]);
    }
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    expect(args).toContain("--append-system-prompt-file");
    // Past the first argument it is the user's own text for claude: left alone.
    await run(["--verbose", "--persona", "revisor-host"], host, project);
    const later = fake.events().filter((e) => e.type === "start")[1] as unknown as {
      args: string[];
    };
    expect(later.args.slice(-3)).toEqual(["--verbose", "--persona", "revisor-host"]);
    expect(later.args).not.toContain("--append-system-prompt-file");
  });

  test("o arquivo some também quando o claude falha, e sem --persona nada muda", async () => {
    const { root, project } = workspace();
    const personas = new Personas({
      db: new EventStore(":memory:").db,
      allowedRoots: [root],
      scanner,
      pack: packPersonas,
    });
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([{ do: "exit", code: 3 }]);
    cleanups.push(fake.restore);
    const failed = await run(["--persona", "sre"], host, project);
    expect(failed.code).toBe(3);
    expect(existsSync(startOf(fake).appendedPath as string)).toBe(false);
    const plain = await run(["--verbose"], host, project);
    const second = fake.events().filter((e) => e.type === "start")[1] as unknown as {
      args: string[];
      appendedPath: string | null;
    };
    expect(plain.code).toBe(3);
    expect(second.appendedPath).toBeNull();
    expect(second.args).not.toContain("--append-system-prompt-file");
  });

  test("persona que não existe, não confiável ou daemon fora do ar: o claude nem abre", async () => {
    const { root, project } = workspace();
    const personas = new Personas({
      db: new EventStore(":memory:").db,
      allowedRoots: [root],
      scanner,
    });
    const dir = join(project, ".flightdeck", "personas");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "do-projeto.md"),
      "---\nid: do-projeto\nname: P\ndescription: d\n---\nCorpo.\n",
    );
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    const missing = await run(["--persona", "nada"], host, project);
    expect(missing.code).toBe(1);
    expect(missing.errors.join("\n")).toMatch(/nada/);
    const untrusted = await run(["--persona", "do-projeto"], host, project);
    expect(untrusted.code).toBe(1);
    expect(untrusted.errors.join("\n")).toMatch(/persona_untrusted|confie/);
    const down = join(tempDir(), "config.json");
    writeFileSync(
      down,
      JSON.stringify({
        token: TOKEN,
        port: 1,
        dataDir: tempDir(),
        hooks: { port: 0, token: HOOKS },
      }),
    );
    const offline = await run(["--persona", "qa"], { file: down }, project);
    expect(offline.code).toBe(1);
    expect(offline.errors.join("\n")).toMatch(/daemon/);
    const noValue = await run(["--persona"], host, project);
    expect(noValue.code).toBe(1);
    expect(fake.events().filter((e) => e.type === "start")).toEqual([]);
  });

  test("fora das pastas permitidas só valem as personas do host e do pacote", async () => {
    const { root } = workspace();
    const personas = new Personas({
      db: new EventStore(":memory:").db,
      allowedRoots: [root],
      scanner,
      pack: packPersonas,
    });
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    const outside = tempDir();
    const result = await run(["--persona", "docs"], host, outside);
    expect(result.code).toBe(0);
    expect(startOf(fake).appended).toMatch(/tech writer/i);
  });
});

describe("personas-sessao-nova: pelo protocolo", () => {
  test("session.create com persona e personas.resolve", async () => {
    const { root, project, personas, manager } = setup();
    const server = startServer({
      manager,
      personas,
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
    const created = await client.data<{ sessionId: string }>("session.create", {
      cwd: project,
      prompt: "oi",
      persona: { id: "revisor-host" },
    });
    expect(manager.get(created?.sessionId ?? "").persona).toMatchObject({ id: "revisor-host" });
    const code = async (type: string, payload: unknown) =>
      ((await client.request(type, payload)).error as { code?: string } | undefined)?.code ?? "ok";
    expect(await code("session.create", { cwd: project, prompt: "oi", persona: {} })).toBe(
      "bad_request",
    );
    expect(
      await code("session.create", {
        cwd: project,
        prompt: "oi",
        persona: { id: "a", definition: REVIEWER },
      }),
    ).toBe("bad_request");
    expect(
      await client.data("personas.resolve", { ref: { id: "revisor-host" }, projectPath: project }),
    ).toMatchObject({
      persona: { id: "revisor-host", effort: "high" },
      source: "host",
    });
    // A folder the daemon does not allow is not an error: only the host's and the pack's apply.
    expect(
      await client.data("personas.resolve", {
        ref: { id: "qa" },
        projectPath: join(root, "..", "fora"),
      }),
    ).toMatchObject({ source: "pack" });
    expect(await code("personas.resolve", { ref: { id: "nada" } })).toBe("not_found");
  });

  test("sem as personas configuradas, session.create com persona e personas.resolve dizem o erro", async () => {
    const { root, project, manager } = setup({ personas: false });
    const server = startServer({
      manager,
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
    const code = async (type: string, payload: unknown) =>
      ((await client.request(type, payload)).error as { code?: string } | undefined)?.code ?? "ok";
    expect(await code("personas.resolve", { ref: { id: "qa" } })).toBe("invalid_state");
    expect(
      await code("session.create", { cwd: project, prompt: "oi", persona: { id: "qa" } }),
    ).toBe("invalid_state");
  });
});
