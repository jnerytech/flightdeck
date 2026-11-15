import { type CronSpec, cronMatches } from "./cron.ts";

export const MINUTE = 60_000;
/** A slot this recent is still fired by a late tick; an older one was missed. */
const GRACE = 2 * MINUTE;
/** How far back a tick or a boot looks for missed slots. */
const WINDOW = 7 * 24 * 60 * MINUTE;
/** Missed slots recorded per automation: the latest ones. */
const MAX_MISSED = 10;

/** The start of the minute `ms` falls in. */
export const minuteOf = (ms: number): number => Math.floor(ms / MINUTE) * MINUTE;

/**
 * The first minute a look at the clock must scan: the one after the last minute seen, but never
 * further back than the window. The very first look has no past: only the current minute counts.
 */
export function scanFrom(last: number | undefined, minute: number): number {
  return last === undefined ? minute : Math.max(last + MINUTE, minute - WINDOW);
}

/**
 * What the minutes `from` to `minute` hold for one cron automation: the slots to fire now (when
 * `fire`, and recent enough) and the missed ones, only the latest few and only when the clock had
 * a past (`hadPast`: a first boot records nothing as missed).
 */
export function planSlots(
  spec: CronSpec,
  zone: string,
  from: number,
  minute: number,
  fire: boolean,
  hadPast: boolean,
): { due: number[]; missed: number[] } {
  const due: number[] = [];
  const missed: number[] = [];
  for (let slot = from; slot <= minute; slot += MINUTE) {
    if (!cronMatches(spec, zone, slot)) continue;
    if (fire && minute - slot <= GRACE) due.push(slot);
    else if (hadPast) missed.push(slot);
  }
  return { due, missed: missed.slice(-MAX_MISSED) };
}
