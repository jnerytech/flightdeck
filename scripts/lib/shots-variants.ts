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

/** The pairs to print, or an error naming the filter when it keeps none (before any browser starts). */
export function pickVariants(env: Record<string, string | undefined>): ShotVariant[] {
  const variants = shotVariants(env);
  if (variants.length === 0) {
    throw new Error(
      `no theme and language pair matches SHOTS_THEME=${env.SHOTS_THEME ?? ""} SHOTS_LANG=${env.SHOTS_LANG ?? ""}`,
    );
  }
  return variants;
}

/** Whether this run prints every screen of every pair: only then is a baseline with no print missing. */
export function isCompleteRun(env: Record<string, string | undefined>): boolean {
  return !env.DEMO_SHOTS && !env.SHOTS_THEME && !env.SHOTS_LANG;
}

/** The `<theme>-<lang>` folders this run prints into. */
export function printedPairs(_env: Record<string, string | undefined>): string[] {
  return [];
}
