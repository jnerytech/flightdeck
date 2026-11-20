/**
 * Pack persona ids that were Portuguese until #3413. An old id still reaches the persona that
 * took its place: a script, a saved team or an older app can send one.
 */
const RENAMED: Readonly<Record<string, string>> = {
  arquiteto: "architect",
  coordenador: "coordinator",
  revisor: "reviewer",
  seguranca: "security",
};

/** The id a pack persona has now for an old one; `null` for any other id. */
export function renamedPersonaId(id: string): string | null {
  return Object.hasOwn(RENAMED, id) ? (RENAMED[id] as string) : null;
}
