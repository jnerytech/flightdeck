import type { CommandResults, PersonaRef } from "@flightdeck/protocol";
import type { Platform } from "../../platform/types.ts";
import { type AppPersona, GlobalPersonas } from "./global-personas.ts";

/** The personas' part of the app's state (#1596): the hosts' lists, read for the pickers. */
export interface PersonasSliceState {
  /** The personas of each host that keeps them (the pack's, the host's), by host id (phase 20). */
  personas: Record<string, AppPersona[]>;
}

/** A fresh initial state for each store: its record is never shared between stores. */
export const initialPersonasState = (): PersonasSliceState => ({ personas: {} });

/** What the personas read and ask through the app's store. */
export interface PersonasCore {
  state(): PersonasSliceState;
  update(patch: Partial<PersonasSliceState>): void;
  /** Where the global personas are kept. */
  storage: Platform["storage"];
  /** A host's personas in a language; null when it refuses (the toast says why). */
  list(hostId: string, language: "pt-BR" | "en"): Promise<CommandResults["personas.list"] | null>;
  /** The app's language now, which names the pack's personas. */
  language(): "pt-BR" | "en";
}

/** The personas a session can take on (phase 20; #1596: a slice of the store). */
export class PersonasSlice {
  /** Phase 20: the global personas, kept by the app. */
  readonly global: GlobalPersonas;

  constructor(private readonly core: PersonasCore) {
    this.global = new GlobalPersonas({ storage: core.storage });
  }

  /** Reads a host's personas (the pack's in the app's language, and the host's) for the pickers. */
  async load(hostId: string): Promise<void> {
    const listed = await this.core.list(hostId, this.core.language());
    if (listed) {
      this.core.update({ personas: { ...this.core.state().personas, [hostId]: listed.personas } });
    }
  }

  /** What a picker's value asks a session for: a persona by id, or an app persona whole. */
  ref(value: string): PersonaRef | null {
    if (value.startsWith("host:")) return { id: value.slice(5), language: this.core.language() };
    if (value.startsWith("app:")) return this.global.ref(value.slice(4), this.core.language());
    return null;
  }
}
