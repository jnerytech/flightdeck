import type { PersonaAgent } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
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

/**
 * Reads, at the edge, what a new session needs from the personas. The session manager takes the
 * result as values and reads no persona file itself. A persona asked for on a host without the
 * persona store is refused.
 */
export async function preparePersonas(
  reader: PersonaReader | undefined,
  ref: PersonaRef | undefined,
  cwd: string,
): Promise<PreparedPersonas> {
  if (!reader) {
    if (ref) {
      throw new FlightdeckError(
        "invalid_state",
        "personas unavailable on this host",
        "personas_off",
      );
    }
    return { persona: null, agents: {} };
  }
  const persona = ref
    ? await reader.resolve(ref, { projectPath: cwd, language: ref.language })
    : null;
  const { agents } = await reader.subagents({ projectPath: cwd });
  return { persona, agents };
}

/** How a caller that starts sessions reads the personas for one; the host's store, else none. */
export type Prepare = (ref: PersonaRef | undefined, cwd: string) => Promise<PreparedPersonas>;

/** For a host without the persona store (and for callers that were not given one). */
export const withoutPersonas: Prepare = (ref, cwd) => preparePersonas(undefined, ref, cwd);
