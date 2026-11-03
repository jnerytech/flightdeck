import type { PersonaAgent } from "@flightdeck/protocol";
import type { PersonaContext, PersonaRef, ResolvedPersona } from "./store.ts";

/** What a new session needs from the personas, read before it is created. */
export interface PreparedPersonas {
  /** The persona the session opens in; `null` for none. */
  persona: ResolvedPersona | null;
  /** The subagents the session can call, as they were when it opened. */
  agents: Record<string, PersonaAgent>;
}

/** The reads of the persona store a session start needs; all of them are asynchronous. */
export interface PersonaReader {
  resolve(ref: PersonaRef, ctx: PersonaContext): Promise<ResolvedPersona>;
  subagents(ctx: PersonaContext): Promise<{ agents: Record<string, PersonaAgent> }>;
}

export async function preparePersonas(
  _reader: PersonaReader | undefined,
  _ref: PersonaRef | undefined,
  _cwd: string,
): Promise<PreparedPersonas> {
  return { persona: null, agents: {} };
}
