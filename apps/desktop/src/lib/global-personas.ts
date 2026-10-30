import {
  normalizePersona,
  type PersonaFields,
  type PersonaInput,
  type PersonaRef,
  SecretScanner,
} from "@flightdeck/protocol";
import type { Platform } from "../platform/types.ts";

/** A persona the library shows: one of a host (the pack's, the host's, a project's) or the app's. */
export type AppPersona = PersonaFields & {
  scope: "pack" | "host" | "project" | "app";
  hash: string | null;
  trusted: boolean;
  modified: boolean;
};

const KEY = "flightdeck.personas";

/** A persona in normal form back to what the form and `PersonaRef.definition` send: no nulls. */
export function personaInput(persona: PersonaFields): PersonaInput {
  return Object.fromEntries(
    Object.entries({
      id: persona.id,
      name: persona.name,
      description: persona.description,
      icon: persona.icon,
      model: persona.model,
      effort: persona.effort,
      tools: persona.tools,
      permissionMode: persona.permissionMode,
      body: persona.body,
    }).filter(([, value]) => value !== null),
  ) as PersonaInput;
}

/** Phase 20: the global personas, in the app's storage, checked by the daemon's own model. */
export class GlobalPersonas {
  private readonly scanner = new SecretScanner();

  constructor(private readonly platform: Pick<Platform, "storage">) {}

  private read(): PersonaFields[] {
    const raw = this.platform.storage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PersonaFields[]) : [];
  }

  list(): AppPersona[] {
    return this.read()
      .map((p): AppPersona => ({ ...p, scope: "app", hash: null, trusted: true, modified: false }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Creates or replaces by id; refuses like the daemon (`bad_request`, `persona_secret`). */
  save(input: PersonaInput): AppPersona {
    const persona = normalizePersona(input, this.scanner);
    const others = this.read().filter((p) => p.id !== persona.id);
    this.platform.storage.setItem(KEY, JSON.stringify([...others, persona]));
    return { ...persona, scope: "app", hash: null, trusted: true, modified: false };
  }

  remove(id: string): void {
    this.platform.storage.setItem(KEY, JSON.stringify(this.read().filter((p) => p.id !== id)));
  }

  /** How a session asks for this persona: the whole definition, since only the app has it. */
  ref(id: string, language: "pt-BR" | "en"): PersonaRef | null {
    const persona = this.read().find((p) => p.id === id);
    return persona ? { definition: personaInput(persona), language } : null;
  }
}
