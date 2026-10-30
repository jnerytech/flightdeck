import type { Platform } from "../platform/types.ts";
import { en } from "./en.ts";
import { ptBR } from "./pt-BR.ts";

export type Lang = "pt-BR" | "en";
export const LANGS: readonly Lang[] = ["pt-BR", "en"];

/** Where the choice is kept; the system's language when absent. */
export const LANG_KEY = "flightdeck.lang";

export interface Plural {
  one: string;
  other: string;
}

type Leaves<T> = {
  readonly [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends Plural
      ? Plural
      : Leaves<T[K]>;
};

/** Every language's shape: pt-BR's keys with string (or plural) leaves. */
export type Dictionary = Leaves<typeof ptBR>;

type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string | Plural ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

/** A dotted key of the dictionary, such as "tray.approve". */
export type Key = Paths<Dictionary>;

export type Vars = Record<string, string | number>;
export type T = (key: Key, vars?: Vars) => string;

/** The app's language for the system's: pt-BR for any pt-*, English for the rest. */
export function languageFor(system: string): Lang {
  return system.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
}

const DICTIONARIES: Record<Lang, Dictionary> = { "pt-BR": ptBR, en };

/** The entry at a dotted key (a string or a plural). */
function entry(dictionary: Dictionary, key: Key): string | Plural {
  let node: unknown = dictionary;
  for (const part of key.split(".")) node = (node as Record<string, unknown>)[part];
  return node as string | Plural;
}

/**
 * `t(key, vars)`: the text of `key` in `lang` with `{name}` replaced from `vars` (a missing one
 * stays visible). A plural picks its form from `vars.n` through Intl.PluralRules.
 */
export function translator(lang: Lang): T {
  const rules = new Intl.PluralRules(lang);
  return (key, vars = {}) => {
    const found = entry(DICTIONARIES[lang], key);
    let text: string;
    if (typeof found === "string") text = found;
    else text = rules.select(Number(vars.n ?? 0)) === "one" ? found.one : found.other;
    return text.replace(/\{(\w+)\}/g, (all, name: string) =>
      name in vars ? String(vars[name]) : all,
    );
  };
}

/** The language in use, its translator and the stored choice; `lang` on <html>. */
export class I18n {
  lang: Lang = "pt-BR";
  t: T = translator("pt-BR");
  private readonly listeners = new Set<() => void>();

  constructor(private readonly platform: Pick<Platform, "storage" | "systemLanguage">) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The stored choice, or the system's language. */
  start(): void {
    const stored = this.platform.storage.getItem(LANG_KEY) as Lang | null;
    const lang =
      stored && LANGS.includes(stored) ? stored : languageFor(this.platform.systemLanguage());
    this.show(lang);
  }

  /** Switches at once (no restart) and keeps the choice. */
  setLang(lang: Lang): void {
    this.platform.storage.setItem(LANG_KEY, lang);
    this.show(lang);
    for (const listener of this.listeners) listener();
  }

  private show(lang: Lang): void {
    this.lang = lang;
    this.t = translator(lang);
    if (typeof document !== "undefined") document.documentElement.lang = lang;
  }
}
