import type { Key, T } from "./index.ts";
import { ptBR } from "./pt-BR.ts";

/**
 * A daemon (or connection) error for the user: the translated title by `code`, with the daemon's
 * own message as the detail. An unknown code shows the daemon's message.
 */
export function translateError(
  code: string,
  message: string,
  t: T,
): { title: string; detail: string } {
  if (!(code in ptBR.errors)) return { title: message, detail: "" };
  return { title: t(`errors.${code}` as Key), detail: message };
}
