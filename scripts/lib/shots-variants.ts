/**
 * The theme and language pairs `demo:shots` prints (#291): all four by default, or the ones
 * SHOTS_THEME and SHOTS_LANG name, so CI runs each pair in a job of its own.
 */
export const THEMES = ["light", "dark"] as const;
export const LANGS = ["pt-BR", "en"] as const;

export interface ShotVariant {
  theme: (typeof THEMES)[number];
  lang: (typeof LANGS)[number];
}

/** The pairs to print; empty when a filter names no known theme or language. */
export function shotVariants(env: Record<string, string | undefined>): ShotVariant[] {
  const theme = env.SHOTS_THEME || undefined;
  const lang = env.SHOTS_LANG || undefined;
  return THEMES.flatMap((t) => LANGS.map((l) => ({ theme: t, lang: l }))).filter(
    (v) => (theme === undefined || v.theme === theme) && (lang === undefined || v.lang === lang),
  );
}
