import type { Lang } from "../i18n/index.ts";

/** Words that never show in simple mode (phase 33): the app's technical vocabulary. */
export const HIDDEN_TERMS: Record<Lang, readonly string[]> = {
  en: [],
  "pt-BR": [],
};

/** The hidden terms a text holds, whole words, whatever the case. */
export function hiddenTermsIn(_text: string, _lang: Lang): string[] {
  return [];
}
