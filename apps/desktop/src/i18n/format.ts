import type { Lang, T } from "./index.ts";

/** Each language's usual date length: 29/10/2026 in pt-BR, Oct 29, 2026 in English. */
const DATE_STYLE: Record<Lang, "short" | "medium"> = { "pt-BR": "short", en: "medium" };

/**
 * Building an Intl.DateTimeFormat is slow (tens of microseconds on x86, far more on a Pi) and the
 * lists format a date per row on every render, so each distinct one is built once.
 */
const formats = new Map<string, Intl.DateTimeFormat>();
function dateFormat(lang: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${lang}|${JSON.stringify(options)}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(lang, options);
    formats.set(key, format);
  }
  return format;
}

/** Intl puts a no-break space before some units; plain spaces keep texts comparable. */
const plain = (text: string) => text.replaceAll(" ", " ");

/** HH:MM of an instant in local time (or `timeZone`), in the language's style. */
export function formatTime(iso: string, lang: Lang, timeZone?: string): string {
  const format = dateFormat(lang, { hour: "2-digit", minute: "2-digit", timeZone });
  return plain(format.format(new Date(iso)));
}

/** Date and time of an instant in local time (or `timeZone`). */
export function formatDateTime(iso: string, lang: Lang, timeZone?: string): string {
  const format = dateFormat(lang, {
    dateStyle: DATE_STYLE[lang],
    timeStyle: "short",
    timeZone,
  });
  return plain(format.format(new Date(iso)));
}

/** A list's short time: HH:MM today, the day and month before. */
export function formatWhen(iso: string, nowMs: number, lang: Lang, timeZone?: string): string {
  const day = (ms: number) =>
    dateFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).format(ms);
  if (day(Date.parse(iso)) === day(nowMs)) return formatTime(iso, lang, timeZone);
  return plain(
    dateFormat(lang, { day: "numeric", month: "short", timeZone }).format(new Date(iso)),
  );
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

/** A calendar day ("2026-10-09") as day and month: 09/10 in pt-BR, 10/09 in English. */
export function formatDay(day: string, lang: Lang): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const format = dateFormat(lang, { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  return format.format(new Date(Date.UTC(year, month - 1, date)));
}

/** A number with the language's separators. */
export function formatNumber(value: number, lang: Lang): string {
  return new Intl.NumberFormat(lang).format(value);
}

/** US dollars (the API's estimated cost), in the language's style. */
export function formatUsd(value: number, lang: Lang): string {
  return plain(new Intl.NumberFormat(lang, { style: "currency", currency: "USD" }).format(value));
}
