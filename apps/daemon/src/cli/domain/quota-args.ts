/**
 * Issue #3460: what `flightdeckd quota` and `flightdeckd usage` take, checked before anything is sent.
 * The parser in `args.ts` adds the usage text to the problem this names.
 */

/** The parsed arguments this check reads: `CliArgs` fits it. */
export interface QuotaArgs {
  command: string;
  action?: string;
  hours?: number;
  days?: number;
}

/** A whole number from 1 to `max`, in digits only: `Number` would take `0x2`, `2e0` and a padded " 2 ". */
export function wholeFrom(flag: string, text: string, max: number): number {
  const n = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isSafeInteger(n) || n < 1 || n > max)
    throw new Error(`${flag} needs a whole number from 1 to ${max}`);
  return n;
}

/** A share of the plan from 0 to 1 as plain decimal digits, or `off` (null); undefined when it is neither. */
export function parseShare(text: string): number | null | undefined {
  if (text === "off") return null;
  if (!/^(0|1)(\.\d+)?$/.test(text)) return undefined;
  const share = Number(text);
  return share <= 1 ? share : undefined;
}

/** What is wrong with the flags of `quota` and `usage`: a flag of the other verb. */
export function quotaProblem(args: QuotaArgs): string | undefined {
  if (args.hours !== undefined && !(args.command === "quota" && args.action === "history"))
    return "--hours: this flag only applies to flightdeckd quota history";
  if (args.days !== undefined && args.command !== "usage")
    return "--days: this flag only applies to flightdeckd usage";
  return undefined;
}
