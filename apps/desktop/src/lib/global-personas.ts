import type { PersonaFields, PersonaInput, PersonaRef } from "@flightdeck/protocol";
import type { Platform } from "../platform/types.ts";

/** A persona the library shows: one of a host (the pack's, the host's, a project's) or the app's. */
export type AppPersona = PersonaFields & {
  scope: "pack" | "host" | "project" | "app";
  hash: string | null;
  trusted: boolean;
  modified: boolean;
};

/** Phase 20: the global personas, in the app's storage, checked by the daemon's own model. */
export class GlobalPersonas {
  constructor(_platform: Pick<Platform, "storage">) {}

  list(): AppPersona[] {
    return [];
  }

  /** Creates or replaces by id; refuses like the daemon (`bad_request`, `persona_secret`). */
  save(_input: PersonaInput): AppPersona {
    return {} as AppPersona;
  }

  remove(_id: string): void {}

  /** How a session asks for this persona: the whole definition, since only the app has it. */
  ref(_id: string, _language: "pt-BR" | "en"): PersonaRef | null {
    return null;
  }
}
