import pkg from "../../package.json";

/** Version of this app; the daemon of the same phase carries the same one. */
export const APP_VERSION: string = pkg.version;

/** Whether version `a` is newer than version `b` (dotted numbers; anything else is not newer). */
export function isNewer(a: string, b: string): boolean {
  const parse = (version: string) => {
    const parts = version
      .split(".")
      .map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
    return parts.some(Number.isNaN) ? null : parts;
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return false;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/**
 * Whether a host offers `feature`. Daemons before phase 7 announce nothing and keep showing what
 * they already had (`legacy`); features born in phase 7 or later need the announcement.
 */
export function hasFeature(
  features: readonly string[] | undefined,
  feature: string,
  legacy: boolean,
): boolean {
  return features ? features.includes(feature) : legacy;
}
