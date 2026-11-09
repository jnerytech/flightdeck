/**
 * The entries of `values` that are set. An option bag spreads what exists instead of testing each
 * key: `{ ...present({ claude, account }) }`.
 */
export function present<T extends Record<string, unknown>>(
  values: T,
): { [K in keyof T]?: NonNullable<T[K]> } {
  return { ...values } as { [K in keyof T]?: NonNullable<T[K]> };
}
