/**
 * The dictionaries' types: a language, a plural, a dictionary's shape and its dotted keys. Their own
 * file so a dictionary and the renames can name them without importing index.ts, which imports
 * them (an import cycle, #1589). Everyone else imports them from index.ts.
 */
import type { ptBR } from "./pt-BR.ts";

export type Lang = "pt-BR" | "en";

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
