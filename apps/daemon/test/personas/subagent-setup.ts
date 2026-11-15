import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PersonaInput } from "@flightdeck/protocol";
import { Board } from "../../src/board/board.ts";
import { ExternalSessions } from "../../src/central/external.ts";
import { type Receptor, startReceptor } from "../../src/central/receptor.ts";
import { RECEPTOR_FILE } from "../../src/central/wrapper.ts";
import { personaHash } from "../../src/personas/domain/model.ts";
import { preparePersonas } from "../../src/personas/domain/prepare.ts";
import { packPersonas } from "../../src/personas/pack.ts";
import { Personas } from "../../src/personas/store.ts";
import { FakeRuntime } from "../../src/runtime/fake-runtime.ts";
import { startServer } from "../../src/server.ts";
import { SessionManager } from "../../src/sessions/session-manager.ts";
import { SecretScanner } from "../../src/snippets/domain/model.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { git, gitRepo } from "../support/board-helpers.ts";
import { newManager, sessionStarter, tempDir, workspace } from "../support/helpers.ts";

export const TOKEN = "t".repeat(32);
export const HOOKS = "hooks-token-0123456789";
export const cleanups: Array<() => unknown> = [];
export async function teardown() {
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

const scanner = new SecretScanner();

export const SECURITY: PersonaInput = {
  id: "seg",
  name: "Segurança do host",
  description: "Revisa segurança",
  model: "claude-opus-5-5",
  tools: ["Read", "Grep"],
  body: "Procure injeção.",
};

export async function codeOf(fn: () => unknown): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
}

export function setup(publisher?: ConstructorParameters<typeof Personas>[0]["publisher"]) {
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

export async function terminalHost(personas: Personas | null, root: string) {
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
    ...(personas ? { personas: { store: personas } } : {}),
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
    JSON.stringify({
      token: TOKEN,
      port: server.port,
      dataDir,
      hooks: { port: 0, token: HOOKS },
    }),
  );
  return { file, dataDir };
}

/** A board, a manager and personas over one database, in a git repository. */
export function boardSetup() {
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
  });
  const board = new Board({
    db: store.db,
    manager,
    allowedRoots: [root],
    preparePersonas: (ref, cwd) => preparePersonas(personas, ref, cwd),
  });
  cleanups.push(() => board.stop());
  cleanups.push(() => manager.shutdown());
  const project = (async () => board.addProject({ path: repo, promptTemplate: "" }))();
  const dir = join(repo, ".flightdeck", "personas");
  const addPersona = async (id: string) => {
    mkdirSync(dir, { recursive: true });
    const source = `---\nid: ${id}\nname: ${id}\ndescription: Do projeto\n---\nCorpo de ${id}.\n`;
    writeFileSync(join(dir, `${id}.md`), source);
    // Versioned, as a team would have it: a card's worktree is made from the base branch.
    git(repo, "add", ".flightdeck");
    git(repo, "commit", "-q", "-m", `persona ${id}`);
    await personas.trust(repo, id, personaHash(source));
  };
  return {
    root,
    repo,
    store,
    personas,
    runtime,
    manager,
    start: sessionStarter(manager, personas),
    board,
    project,
    addPersona,
  };
}
