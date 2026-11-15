import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PersonaInput } from "@flightdeck/protocol";
import { ExternalSessions } from "../../src/central/external.ts";
import { type Receptor, startReceptor } from "../../src/central/receptor.ts";
import { RECEPTOR_FILE } from "../../src/central/wrapper.ts";
import { packPersonas } from "../../src/personas/pack.ts";
import { Personas } from "../../src/personas/store.ts";
import { startServer } from "../../src/server.ts";
import { SecretScanner } from "../../src/snippets/domain/model.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { newManager, tempDir, workspace } from "../support/helpers.ts";

export const TOKEN = "t".repeat(32);
export const HOOKS = "hooks-token-0123456789";
export const cleanups: Array<() => unknown> = [];
export async function teardown() {
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

export const scanner = new SecretScanner();

export const REVIEWER: PersonaInput = {
  id: "revisor-host",
  name: "Revisor do host",
  description: "Revisa",
  model: "claude-opus-5-5",
  effort: "high",
  tools: ["Read", "Grep"],
  permissionMode: "plan",
  body: "Você atua como revisor. Não altere código.",
};

export function codeOf(fn: () => unknown): Promise<string> | string {
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

export async function setup(options: { personas?: boolean } = {}) {
  const { root, project } = workspace();
  const store = new EventStore(":memory:");
  const personas = new Personas({
    db: store.db,
    allowedRoots: [root],
    scanner,
    pack: packPersonas,
  });
  await personas.save({ scope: "host", persona: REVIEWER });
  const made = newManager({
    store,
    allowedRoots: [root],
    ...(options.personas === false ? {} : { personas }),
  });
  cleanups.push(() => made.manager.shutdown());
  return { ...made, root, project, personas, store };
}

/** A config with the hooks token and a live receptor, like the daemon, and a daemon to ask. */
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
    JSON.stringify({ token: TOKEN, port: server.port, dataDir, hooks: { port: 0, token: HOOKS } }),
  );
  return { file, dataDir, server };
}
