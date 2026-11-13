import { packPersonas } from "./pack.ts";
import { type Prepare, preparePersonas } from "./prepare.ts";
import { agentPublisher } from "./publish.ts";
import { Personas, type PersonasOptions } from "./store.ts";

/** What the personas are built from (issue #1593). */
export interface PersonasDeps {
  db: PersonasOptions["db"];
  allowedRoots: PersonasOptions["allowedRoots"];
  scanner: PersonasOptions["scanner"];
  /** Phase 12's agent editor, which also writes the personas published as project agents. */
  agents: Parameters<typeof agentPublisher>[0];
  log?: PersonasOptions["log"];
}

/** The persona store, with phase 20's pack, and the read a new session makes of it. */
export function createPersonas({ db, allowedRoots, scanner, agents, log }: PersonasDeps) {
  const personaStore = new Personas({
    db,
    allowedRoots,
    scanner,
    pack: packPersonas,
    publisher: agentPublisher(agents),
    log,
  });
  const prepare: Prepare = (ref, cwd) => preparePersonas(personaStore, ref, cwd);
  return { personaStore, prepare };
}
