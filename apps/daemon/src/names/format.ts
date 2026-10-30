/** Phase 21, standard session names: `project · persona · number` and its alias. */

/** The persona of a session that has none. */
export const GENERAL = "geral";

export interface NameParts {
  project: string;
  persona: string | null;
  /** The card's number, for a session of a card. */
  cardNumber?: number | null;
  /** The sequence: per project and persona, or the run of the card. */
  number: number;
}

/** `Revisor de Código!` into `revisor-de-codigo`. */
export function slug(_text: string): string {
  return "";
}

/** The name of the project: the end of its key (`github.com/acme/app` is `app`) or its folder. */
export function projectName(_keyOrPath: string): string {
  return "";
}

/** `flightdeck · revisor · 3`, or `flightdeck · revisor · card 42`. */
export function displayName(_parts: NameParts): string {
  return "";
}

/** `flightdeck-revisor-3`: lower case, no accents, hyphens. */
export function aliasName(_parts: NameParts): string {
  return "";
}
