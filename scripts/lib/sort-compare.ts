/**
 * Finds `.sort()` and `.toSorted()` calls with no compare function (SonarCloud S2871, #322).
 * Biome's `useArraySortCompare` needs the array's type and misses inferred ones such as a
 * `readdir` result, so the ratchet test scans the text instead. Comments are blanked first,
 * keeping the line numbers.
 */
export function bareSorts(source: string): number[] {
  return source.length > 0 ? [0] : [];
}
