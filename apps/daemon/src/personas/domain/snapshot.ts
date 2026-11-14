import type { PersonaFields } from "@flightdeck/protocol";
import type { PersonaDef } from "./model.ts";

/**
 * What a session keeps of its persona: the body that is appended to the system prompt, the model,
 * the effort and the tools, as they were when the session opened. The appended prompt is not in
 * the transcript, so it has to be given again every time the run starts (resume, reattach), and a
 * later edit of the persona, or a trust taken away, does not change a session that is alive.
 */
export interface PersonaSnapshot {
  id: string;
  name: string;
  icon: string | null;
  /** The hash of the versioned file, for a persona from a project. */
  hash: string | null;
  append: string;
  model: string | null;
  effort: NonNullable<PersonaFields["effort"]> | null;
  tools: string[] | null;
}

export function snapshotOf(persona: PersonaDef, hash: string | null): PersonaSnapshot {
  return {
    id: persona.id,
    name: persona.name,
    icon: persona.icon,
    hash,
    append: persona.body,
    model: persona.model,
    effort: persona.effort,
    tools: persona.tools,
  };
}
