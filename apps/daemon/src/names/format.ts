/** Phase 21, standard session names: `project · persona · number` and its alias. */

/** The persona of a session that has none. */
export const GENERAL = "geral";
/** The project of a session that has no folder to name it. */
const NO_PROJECT = "sem-projeto";

export interface NameParts {
  project: string;
  persona: string | null;
  /** The card's number, for a session of a card. */
  cardNumber?: number | null;
  /** The sequence: per project and persona, or the run of the card. */
  number: number;
}

/** `Revisor de Código!` into `revisor-de-codigo`. */
export function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The name of the project: the end of its key (`github.com/acme/app` is `app`) or its folder. */
export function projectName(keyOrPath: string): string {
  const trimmed = keyOrPath.trim().replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return trimmed.slice(cut + 1) || NO_PROJECT;
}

/** What follows the persona: the number, or `card 42` and the run of the card from the second. */
function sequence(parts: NameParts): string[] {
  if (parts.cardNumber == null) return [String(parts.number)];
  const card = `card ${parts.cardNumber}`;
  return parts.number > 1 ? [card, String(parts.number)] : [card];
}

/** `flightdeck · revisor · 3`, or `flightdeck · revisor · card 42`. */
export function displayName(parts: NameParts): string {
  const persona = parts.persona?.trim() || GENERAL;
  return [parts.project, persona, ...sequence(parts)].join(" · ");
}

/** `flightdeck-revisor-3`: lower case, no accents, hyphens. */
export function aliasName(parts: NameParts): string {
  const project = slug(parts.project) || NO_PROJECT;
  const persona = slug(parts.persona ?? "") || GENERAL;
  return [project, persona, ...sequence(parts).map(slug)].join("-");
}
