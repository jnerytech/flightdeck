/**
 * Phase 13: five-field cron (`minute hour day-of-month month day-of-week`), evaluated in a time
 * zone. Fields take `*`, numbers, ranges, lists and steps (`1-5`, `8-18/2`, `1,15`, or a step of
 * 15 over the whole field); the day
 * of week takes 0-7 (0 and 7 are Sunday). As in Vixie cron, when both day fields are restricted a
 * day matches if either does.
 */

export interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  /** The field starts with `*`: it does not restrict, so the two day fields combine with AND. */
  domAny: boolean;
  dowAny: boolean;
}

const NUMBER = /^\d+$/;

function parseField(text: string, label: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const [range = "", step, extra] = part.split("/");
    const every = step === undefined ? 1 : Number(step);
    if (extra !== undefined || (step !== undefined && !NUMBER.test(step)) || every < 1) {
      throw new Error(`cron: passo inválido em ${label}: ${part}`);
    }
    let low: number;
    let high: number;
    if (range === "*") {
      [low, high] = [min, max];
    } else {
      const [from = "", to, more] = range.split("-");
      if (!NUMBER.test(from) || (to !== undefined && !NUMBER.test(to)) || more !== undefined) {
        throw new Error(`cron: valor inválido em ${label}: ${part}`);
      }
      low = Number(from);
      // "5/10" runs from 5 to the end of the field; a plain "5" is just 5.
      high = low;
      if (to !== undefined) high = Number(to);
      else if (step !== undefined) high = max;
    }
    if (low < min || high > max || low > high) {
      throw new Error(`cron: ${label} fora de ${min}-${max}: ${part}`);
    }
    for (let value = low; value <= high; value += every) values.add(value);
  }
  return values;
}

/** The parsed expression; throws an `Error` that says what is wrong. */
export function parseCron(expr: string): CronSpec {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5)
    throw new Error("cron: são 5 campos (minuto hora dia mês dia-da-semana)");
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];
  const days = parseField(dow, "dia da semana", 0, 7);
  if (days.delete(7)) days.add(0);
  return {
    minute: parseField(minute, "minuto", 0, 59),
    hour: parseField(hour, "hora", 0, 23),
    dom: parseField(dom, "dia do mês", 1, 31),
    month: parseField(month, "mês", 1, 12),
    dow: days,
    domAny: dom.startsWith("*"),
    dowAny: dow.startsWith("*"),
  };
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    formatters.set(timeZone, found);
  }
  return found;
}

/** Whether `timeZone` is a zone the runtime knows (`America/Sao_Paulo`, `UTC`). */
export function validTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Whether the minute that holds `ms`, in `timeZone`, is one of the expression's. */
export function cronMatches(spec: CronSpec, timeZone: string, ms: number): boolean {
  const at: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(ms)) at[part.type] = part.value;
  const day = Number(at.day);
  const weekday = WEEKDAYS[at.weekday as string] as number;
  const dayOk =
    spec.domAny || spec.dowAny
      ? spec.dom.has(day) && spec.dow.has(weekday)
      : spec.dom.has(day) || spec.dow.has(weekday);
  return (
    spec.minute.has(Number(at.minute)) &&
    spec.hour.has(Number(at.hour)) &&
    spec.month.has(Number(at.month)) &&
    dayOk
  );
}
