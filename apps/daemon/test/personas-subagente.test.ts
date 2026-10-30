import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { PersonaInput } from "@flightdeck/protocol";
import { Board } from "../src/board/board.ts";
import { ExternalSessions } from "../src/central/external.ts";
import { type Receptor, startReceptor } from "../src/central/receptor.ts";
import { RECEPTOR_FILE } from "../src/central/wrapper.ts";
import { runCli } from "../src/main.ts";
import { personaHash } from "../src/personas/model.ts";
import { PACK_IDS, packPersonas } from "../src/personas/pack.ts";
import { Personas } from "../src/personas/store.ts";
import { ClaudeSdkRuntime, type QueryFn } from "../src/runtime/claude-sdk-runtime.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import { startServer } from "../src/server.ts";
import { SessionManager } from "../src/sessions/session-manager.ts";
import { SecretScanner } from "../src/snippets/model.ts";
import { EventStore } from "../src/store/event-store.ts";
import { cardWhen, git, gitRepo } from "./board-helpers.ts";
import { installFakeClaude } from "./fake-claude.ts";
import { newManager, tempDir, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(40_000);

const TOKEN = "t".repeat(32);
const HOOKS = "hooks-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const scanner = new SecretScanner();

const SECURITY: PersonaInput = {
  id: "seg",
  name: "Segurança do host",
  description: "Revisa segurança",
  model: "claude-opus-5-5",
  tools: ["Read", "Grep"],
  body: "Procure injeção.",
};

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
}

function setup(publisher?: ConstructorParameters<typeof Personas>[0]["publisher"]) {
  const { root, project } = workspace();
  const store = new EventStore(":memory:");
  const personas = new Personas({
    db: store.db,
    allowedRoots: [root],
    scanner,
    pack: packPersonas,
    ...(publisher ? { publisher } : {}),
  });
  const dir = join(project, ".flightdeck", "personas");
  const writeProject = (id: string, name: string, body: string) => {
    mkdirSync(dir, { recursive: true });
    const source = `---\nid: ${id}\nname: ${name}\ndescription: Do projeto\n---\n${body}\n`;
    writeFileSync(join(dir, `${id}.md`), source);
    return personaHash(source);
  };
  return { root, project, store, personas, writeProject };
}

describe("personas-subagente: o que vira agente", () => {
  test("toda persona que vale no projeto vira o agente persona-<id>, com descrição, corpo, ferramentas e modelo", () => {
    const { personas, project } = setup();
    personas.save({ scope: "host", persona: SECURITY });
    const { agents, untrusted } = personas.subagents({ projectPath: project });
    // The nine of the pack, plus the host's own.
    expect(Object.keys(agents).sort()).toEqual(
      [...PACK_IDS, "seg"].map((id) => `persona-${id}`).sort(),
    );
    expect(untrusted).toEqual([]);
    expect(agents["persona-seg"]).toEqual({
      description: "Revisa segurança",
      prompt: "Procure injeção.",
      tools: ["Read", "Grep"],
      model: "claude-opus-5-5",
    });
    // A persona with no tools or model leaves them out: the agent inherits the session's.
    expect(agents["persona-docs"]).not.toHaveProperty("tools");
    expect(agents["persona-revisor"]).toMatchObject({
      description: expect.stringContaining("Revisa legibilidade"),
      tools: ["Read", "Grep", "Glob", "Bash"],
      model: "claude-sonnet-5-5",
    });
    expect(agents["persona-qa"]?.prompt).toMatch(/engenheiro de QA sênior/);
  });

  test("a do projeto vale mais que a do host e a do pacote; sem confiança, fica de fora e é avisada", () => {
    const { personas, project, writeProject } = setup();
    const hash = writeProject("revisor", "Revisor do projeto", "Corpo do projeto.");
    writeProject("novo", "Novo", "Outro.");
    personas.trust(project, "revisor", hash);
    const { agents, untrusted } = personas.subagents({ projectPath: project });
    expect(agents["persona-revisor"]?.prompt).toBe("Corpo do projeto.");
    expect(agents).not.toHaveProperty("persona-novo");
    expect(untrusted).toEqual(["novo"]);
    // An untrusted project file does not even stand in for the pack's persona of the same id.
    writeProject("qa", "QA do projeto", "Corpo suspeito.");
    const again = personas.subagents({ projectPath: project });
    expect(again.agents["persona-qa"]?.prompt).toMatch(/QA/);
    expect(again.agents["persona-qa"]?.prompt).not.toContain("suspeito");
    expect(again.untrusted.sort()).toEqual(["novo", "qa"]);
  });

  test("no idioma pedido, e fora das pastas permitidas só o host e o pacote", () => {
    const { personas, root } = setup();
    expect(personas.subagents({ language: "en" }).agents["persona-qa"]?.prompt).toMatch(
      /You act as a senior QA/,
    );
    expect(
      Object.keys(personas.subagents({ projectPath: join(root, "..", "fora") }).agents),
    ).toHaveLength(10);
  });
});

describe("personas-subagente: sessão gerenciada", () => {
  test("a sessão ganha os agentes persona-<id> em toda execução, e sem o cadastro de personas não ganha nenhum", () => {
    const { personas, root, project, store } = setup();
    const { manager, runtime } = newManager({ store, allowedRoots: [root], personas });
    cleanups.push(() => manager.shutdown());
    manager.create({ cwd: project, prompt: "oi" });
    const names = Object.keys(runtime.starts[0]?.agents ?? {});
    expect(names).toContain("persona-revisor");
    expect(names).toHaveLength(10);
    expect(runtime.starts[0]?.agents?.["persona-seguranca"]).toMatchObject({
      tools: ["Read", "Grep", "Glob", "Bash"],
      model: "claude-opus-5-5",
    });
    const bare = newManager();
    cleanups.push(() => bare.manager.shutdown());
    bare.manager.create({ cwd: bare.project, prompt: "oi" });
    expect(bare.runtime.starts[0]?.agents).toBeUndefined();
  });

  test("o runtime do SDK passa agents para o SDK, e sem eles nada muda", () => {
    const seen: Options[] = [];
    const query: QueryFn = ({ options }) => {
      seen.push(options);
      return { async *[Symbol.asyncIterator]() {}, interrupt: async () => {}, close: () => {} };
    };
    const runtime = new ClaudeSdkRuntime({ query });
    const base = {
      cwd: "/w",
      permissionMode: "default" as const,
      env: {},
      canUseTool: async () => ({ behavior: "deny" as const, message: "x" }),
    };
    runtime.start({
      ...base,
      agents: { "persona-qa": { description: "d", prompt: "p", tools: ["Read"] } },
    });
    runtime.start(base);
    expect(seen[0]?.agents).toEqual({
      "persona-qa": { description: "d", prompt: "p", tools: ["Read"] },
    });
    expect("agents" in (seen[1] as Options)).toBe(false);
  });
});

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
  return { file, dataDir };
}

describe("personas-subagente: o terminal, flightdeckd claude --agents", () => {
  async function run(args: string[], host: { file: string }, cwd?: string) {
    const exit = { code: null as number | null };
    await runCli(["claude", ...args], {
      env: { ...process.env, FLIGHTDECK_CONFIG: host.file },
      log: { log: () => {}, error: () => {} },
      exit: (c) => {
        exit.code = c;
      },
      onSignal: () => {},
      selfCommand: [process.execPath, "run", join(import.meta.dir, "..", "src", "bin.ts")],
      ...(cwd ? { cwd } : {}),
    });
    return exit.code;
  }

  const startsOf = (fake: ReturnType<typeof installFakeClaude>) =>
    fake.events().filter((e) => e.type === "start") as unknown as Array<{
      args: string[];
      agents: Record<string, { description: string; prompt: string }> | null;
      agentsPath: string | null;
    }>;

  test("passa --agents com um arquivo JSON dos persona-<id>, que existe enquanto o claude roda e some depois", async () => {
    const { root, project, personas } = setup();
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    expect(await run([], host, project)).toBe(0);
    const [start] = startsOf(fake);
    expect(start?.args).toContain("--agents");
    expect(Object.keys(start?.agents ?? {})).toContain("persona-revisor");
    expect(start?.agents?.["persona-revisor"]?.description).toMatch(/Revisa legibilidade/);
    // A file, never the JSON on the command line (nine bodies do not fit on one in Windows).
    expect(start?.args.some((arg) => arg.startsWith("{"))).toBe(false);
    const { existsSync } = await import("node:fs");
    expect(existsSync(start?.agentsPath as string)).toBe(false);
  });

  test("junto de --persona: os dois arquivos, apagados no fim", async () => {
    const { root, project, personas } = setup();
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([{ do: "exit", code: 2 }]);
    cleanups.push(fake.restore);
    expect(await run(["--persona", "qa"], host, project)).toBe(2);
    const [start] = startsOf(fake);
    expect(start?.args).toContain("--agents");
    expect(start?.args).toContain("--append-system-prompt-file");
    const { existsSync, readdirSync } = await import("node:fs");
    expect(existsSync(start?.agentsPath as string)).toBe(false);
    expect(readdirSync(join(host.dataDir, "personas"))).toEqual([]);
  });

  test("o --agents do próprio usuário vale; sem o daemon, ou sem personas, o claude abre do mesmo jeito", async () => {
    const { root, project, personas } = setup();
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    await run(["--agents", "{}"], host, project);
    const own = startsOf(fake)[0]?.args ?? [];
    expect(own.filter((a) => a === "--agents")).toHaveLength(1);
    expect(own[own.indexOf("--agents") + 1]).toBe("{}");
    await run(["--agents={}"], host, project);
    expect((startsOf(fake)[1]?.args ?? []).filter((a) => a.startsWith("--agents"))).toHaveLength(1);
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
    expect(await run([], { file: down }, project)).toBe(0);
    expect(startsOf(fake)[2]?.args).not.toContain("--agents");
    const bare = await terminalHost(null, root);
    expect(await run([], bare, project)).toBe(0);
    expect(startsOf(fake)[3]?.args).not.toContain("--agents");
  });
});

describe("personas-subagente: publicar como agente do projeto", () => {
  test("pede confirmação antes de qualquer coisa, e grava pelo editor de agentes (ponto de extensão) o persona-<id>", () => {
    const published: Array<{
      projectPath: string;
      name: string;
      description: string;
      prompt: string;
      tools?: string[];
      model?: string;
    }> = [];
    const { personas, project } = setup({
      publish: (request) => {
        published.push(request);
        return { path: join(request.projectPath, ".claude", "agents", `${request.name}.md`) };
      },
    });
    expect(
      codeOf(() =>
        personas.publishAgent({ id: "seguranca", projectPath: project, confirm: false }),
      ),
    ).toBe("invalid_state");
    expect(published).toEqual([]);
    const done = personas.publishAgent({ id: "seguranca", projectPath: project, confirm: true });
    expect(done.path.endsWith("persona-seguranca.md")).toBe(true);
    expect(published).toEqual([
      {
        projectPath: project,
        name: "persona-seguranca",
        description: expect.stringContaining("Revisa mudanças"),
        prompt: expect.stringContaining("Não altere código"),
        tools: ["Read", "Grep", "Glob", "Bash"],
        model: "claude-opus-5-5",
      },
    ]);
    expect(
      codeOf(() =>
        personas.publishAgent({ id: "nao-existe", projectPath: project, confirm: true }),
      ),
    ).toBe("not_found");
    expect(
      codeOf(() =>
        personas.publishAgent({
          id: "qa",
          projectPath: join(project, "..", "..", "fora"),
          confirm: true,
        }),
      ),
    ).toBe("forbidden_cwd");
  });

  test("uma persona versionada sem confiança não se publica", () => {
    const { personas, project, writeProject } = setup({ publish: () => ({ path: "x" }) });
    writeProject("nova", "Nova", "Corpo.");
    expect(
      codeOf(() => personas.publishAgent({ id: "nova", projectPath: project, confirm: true })),
    ).toBe("persona_untrusted");
  });

  test("sem o editor de agentes (Fase 12) configurado, o pedido confirmado diz que falta", () => {
    const { personas, project } = setup();
    expect(
      codeOf(() => personas.publishAgent({ id: "qa", projectPath: project, confirm: true })),
    ).toBe("invalid_state");
    expect(
      codeOf(() => personas.publishAgent({ id: "qa", projectPath: project, confirm: false })),
    ).toBe("invalid_state");
  });
});

describe("personas-subagente: pelo protocolo", () => {
  test("personas.subagents e personas.publishAgent", async () => {
    const published: string[] = [];
    const { personas, root, project, writeProject } = setup({
      publish: (request) => {
        published.push(request.name);
        return { path: "p" };
      },
    });
    writeProject("nova", "Nova", "Corpo.");
    const { manager } = newManager();
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
    const code = async (type: string, payload: unknown) =>
      ((await client.request(type, payload)).error as { code?: string } | undefined)?.code ?? "ok";
    const result = await client.data<{ agents: Record<string, unknown>; untrusted: string[] }>(
      "personas.subagents",
      {
        projectPath: project,
        language: "en",
      },
    );
    expect(Object.keys(result?.agents ?? {})).toHaveLength(10);
    expect(result?.untrusted).toEqual(["nova"]);
    expect(
      await client.data("personas.publishAgent", { id: "qa", projectPath: project, confirm: true }),
    ).toEqual({ path: "p" });
    expect(published).toEqual(["persona-qa"]);
    expect(await code("personas.publishAgent", { id: "qa", projectPath: project })).toBe(
      "bad_request",
    );
    expect(
      await code("personas.publishAgent", { id: "qa", projectPath: project, confirm: false }),
    ).toBe("invalid_state");
  });

  test("sem as personas configuradas, os comandos dizem que está desativado", async () => {
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
    const code = async (type: string, payload: unknown) =>
      ((await client.request(type, payload)).error as { code?: string } | undefined)?.code ?? "ok";
    expect(await code("personas.subagents", {})).toBe("invalid_state");
    expect(
      await code("personas.publishAgent", { id: "qa", projectPath: "/x", confirm: true }),
    ).toBe("invalid_state");
  });
});

/** A board, a manager and personas over one database, in a git repository. */
function boardSetup() {
  const { root, repo } = gitRepo();
  const store = new EventStore(":memory:");
  const personas = new Personas({
    db: store.db,
    allowedRoots: [root],
    scanner,
    pack: packPersonas,
  });
  const runtime = new FakeRuntime({ delayMs: 1 });
  const manager = new SessionManager({
    store,
    runtime,
    allowedRoots: [root],
    defaultPermissionMode: "default",
    allowApiKey: false,
    baseEnv: {},
    personas,
  });
  const board = new Board({ db: store.db, manager, allowedRoots: [root] });
  cleanups.push(() => board.stop());
  cleanups.push(() => manager.shutdown());
  const project = (async () => board.addProject({ path: repo, promptTemplate: "" }))();
  const dir = join(repo, ".flightdeck", "personas");
  const addPersona = (id: string) => {
    mkdirSync(dir, { recursive: true });
    const source = `---\nid: ${id}\nname: ${id}\ndescription: Do projeto\n---\nCorpo de ${id}.\n`;
    writeFileSync(join(dir, `${id}.md`), source);
    // Versioned, as a team would have it: a card's worktree is made from the base branch.
    git(repo, "add", ".flightdeck");
    git(repo, "commit", "-q", "-m", `persona ${id}`);
    personas.trust(repo, id, personaHash(source));
  };
  return { root, repo, store, personas, runtime, manager, board, project, addPersona };
}

describe("personas-subagente: o interruptor do projeto", () => {
  test("o padrão é all: o pacote e as do projeto; project só as do projeto; none nenhuma", async () => {
    const { board, personas, repo, project, addPersona } = boardSetup();
    const { id } = await project;
    expect(board.getProject(id).personaSubagents).toBe("all");
    addPersona("do-projeto");
    const names = () => Object.keys(personas.subagents({ projectPath: repo }).agents).sort();
    expect(names()).toHaveLength(11);
    expect(names()).toContain("persona-do-projeto");
    board.updateProject(id, { personaSubagents: "project" });
    expect(board.getProject(id).personaSubagents).toBe("project");
    expect(names()).toEqual(["persona-do-projeto"]);
    // The versioned ones without trust are still reported, so the person knows why.
    writeFileSync(
      join(repo, ".flightdeck", "personas", "sem-confianca.md"),
      "---\nid: sem-confianca\nname: X\ndescription: d\n---\nCorpo.\n",
    );
    expect(personas.subagents({ projectPath: repo }).untrusted).toEqual(["sem-confianca"]);
    board.updateProject(id, { personaSubagents: "none" });
    expect(personas.subagents({ projectPath: repo })).toEqual({ agents: {}, untrusted: [] });
    board.updateProject(id, { personaSubagents: "all" });
    expect(names()).toHaveLength(11);
  });

  test("só all, project e none; a pasta que não é de projeto nenhum fica no padrão", async () => {
    const { board, personas, project, root } = boardSetup();
    const { id } = await project;
    let failure = "ok";
    try {
      board.updateProject(id, { personaSubagents: "tudo" as never });
    } catch (error) {
      failure = (error as { code?: string }).code ?? "sem código";
    }
    expect(failure).toBe("bad_request");
    expect(board.getProject(id).personaSubagents).toBe("all");
    expect(Object.keys(personas.subagents({ projectPath: root }).agents)).toHaveLength(10);
  });

  test("a sessão gerenciada do projeto, e a do card na worktree dele, seguem o interruptor", async () => {
    const { board, manager, runtime, repo, project, addPersona } = boardSetup();
    const { id } = await project;
    addPersona("do-projeto");
    manager.create({ cwd: repo, prompt: "oi" });
    expect(Object.keys(runtime.starts[0]?.agents ?? {})).toHaveLength(11);
    board.updateProject(id, { personaSubagents: "none" });
    manager.create({ cwd: repo, prompt: "oi" });
    expect(runtime.starts[1]?.agents).toBeUndefined();
    // A card runs in a worktree of its own, which still belongs to the project.
    const card = board.createCard(id, { title: "Tarefa", description: "faça" });
    await board.startCard(card.id);
    const running = await cardWhen(board, card.id, (c) => c.sessionId !== null);
    expect(running?.worktreePath).not.toBe(repo);
    expect(runtime.starts.at(-1)?.agents).toBeUndefined();
    board.updateProject(id, { personaSubagents: "project" });
    const worktree = running?.worktreePath ?? repo;
    manager.create({ cwd: worktree, prompt: "oi" });
    expect(Object.keys(runtime.starts.at(-1)?.agents ?? {})).toEqual(["persona-do-projeto"]);
    // The trust given to the project holds for its worktrees: the file there is the same one.
    const { sessionId } = manager.create({
      cwd: worktree,
      prompt: "oi",
      persona: { id: "do-projeto" },
    });
    expect(manager.get(sessionId).persona).toMatchObject({ id: "do-projeto" });
  });

  test("o --agents do wrapper também: sem arquivo com none, só as do projeto com project", async () => {
    const { board, personas, root, repo, project, addPersona } = boardSetup();
    const { id } = await project;
    addPersona("do-projeto");
    const host = await terminalHost(personas, root);
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    const run = async () => {
      await runCli(["claude"], {
        env: { ...process.env, FLIGHTDECK_CONFIG: host.file },
        log: { log: () => {}, error: () => {} },
        exit: () => {},
        onSignal: () => {},
        selfCommand: [process.execPath, "run", join(import.meta.dir, "..", "src", "bin.ts")],
        cwd: repo,
      });
      return fake
        .events()
        .filter((e) => e.type === "start")
        .at(-1) as unknown as {
        args: string[];
        agents: Record<string, unknown> | null;
      };
    };
    board.updateProject(id, { personaSubagents: "project" });
    expect(Object.keys((await run()).agents ?? {})).toEqual(["persona-do-projeto"]);
    board.updateProject(id, { personaSubagents: "none" });
    const none = await run();
    expect(none.args).not.toContain("--agents");
    expect(none.agents).toBeNull();
  });
});
