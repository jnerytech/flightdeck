import type { Lang, T } from "./index.ts";

/** Each language's usual date length: 29/10/2026 in pt-BR, Oct 29, 2026 in English. */
const DATE_STYLE: Record<Lang, "short" | "medium"> = { "pt-BR": "short", en: "medium" };

/** Intl puts a no-break space before some units; plain spaces keep texts comparable. */
const plain = (text: string) => text.replaceAll(" ", " ");

/** HH:MM of an instant in local time (or `timeZone`), in the language's style. */
export function formatTime(iso: string, lang: Lang, timeZone?: string): string {
  const format = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit", timeZone });
  return plain(format.format(new Date(iso)));
}

/** Date and time of an instant in local time (or `timeZone`). */
export function formatDateTime(iso: string, lang: Lang, timeZone?: string): string {
  const format = new Intl.DateTimeFormat(lang, {
    dateStyle: DATE_STYLE[lang],
    timeStyle: "short",
    timeZone,
  });
  return plain(format.format(new Date(iso)));
}

/** "2 h 5 min", "2 h", "3 min" or "45 s" (seconds only under a minute). */
export function formatDuration(ms: number, t: T): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return t("time.seconds", { n: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("time.minutes", { n: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? t("time.hours", { n: h }) : t("time.hoursMinutes", { h, m });
}

/** "há 3 min" / "3 min ago"; under a minute, "agora". */
export function formatAgo(ms: number, t: T): string {
  return ms < 60_000 ? t("time.now") : t("time.ago", { d: formatDuration(ms, t) });
}

/** A number with the language's separators. */
export function formatNumber(value: number, lang: Lang): string {
  return new Intl.NumberFormat(lang).format(value);
}

/** US dollars (the API's estimated cost), in the language's style. */
export function formatUsd(value: number, lang: Lang): string {
  return plain(new Intl.NumberFormat(lang, { style: "currency", currency: "USD" }).format(value));
}
