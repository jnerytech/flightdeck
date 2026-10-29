import pkg from "../../package.json";

/** Version of this app; the daemon of the same phase carries the same one. */
export const APP_VERSION: string = pkg.version;

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
