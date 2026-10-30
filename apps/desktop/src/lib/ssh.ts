/** The tags that mark a ssh destino as production, whatever their case. */
const PROD_TAGS: ReadonlySet<string> = new Set(["prod", "produ\u00e7\u00e3o", "producao"]);

export const isProd = (tags: readonly string[]): boolean =>
  tags.some((tag) => PROD_TAGS.has(tag.toLowerCase()));
