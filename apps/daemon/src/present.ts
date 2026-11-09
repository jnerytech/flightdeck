/**
 * The entries of `values` that are set: a key whose value is `undefined` or `null` is left out. An
 * option bag spreads what exists instead of testing each key: `{ ...present({ claude, account }) }`.
 */
export function present<T extends Record<string, unknown>>(
  values: T,
): { [K in keyof T]?: NonNullable<T[K]> } {
  const set = Object.entries(values).filter(([, value]) => value !== undefined && value !== null);
  return Object.fromEntries(set) as { [K in keyof T]?: NonNullable<T[K]> };
}
