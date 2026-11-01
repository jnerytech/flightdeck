import type { Key, T } from "./index.ts";
import { ptBR } from "./pt-BR.ts";

/**
 * A daemon (or connection) error for the user: the translated title by `code`, with the daemon's
 * own message as the detail. An unknown code gets a generic title; the message is never the only
 * thing shown. An app-side error (no code) is its own text.
 */
export function translateError(
  code: string,
  message: string,
  t: T,
  _why?: { reason?: string; params?: Record<string, string | number> },
): { title: string; detail: string } {
  if (code === "") return { title: message, detail: "" };
  const known = code in ptBR.errors && code !== "unknown";
  return { title: t(`errors.${known ? code : "unknown"}` as Key), detail: message };
}

/** One line for a form or a panel: the translated text, then the daemon's message when it has one. */
export function refusalText(
  code: string,
  message: string,
  t: T,
  why?: { reason?: string; params?: Record<string, string | number> },
): string {
  // A reason the app has a text for is the whole sentence; the message is for logs.
  if (why?.reason && why.reason in ptBR.snippetRefusal) {
    return t(`snippetRefusal.${why.reason}` as Key, why.params);
  }
  const { title, detail } = translateError(code, message, t);
  return detail ? `${title} ${detail}` : title;
}
