/**
 * Finds `.sort()` and `.toSorted()` calls with no compare function (SonarCloud S2871, #322).
 * Biome's `useArraySortCompare` needs the array's type and misses inferred ones such as a
 * `readdir` result, so the ratchet test scans the text instead. Comments are blanked first,
 * keeping the line numbers.
 */
export function bareSorts(source: string): number[] {
  // A comment opens at the line start or after a space, so `**/*.ts` in a glob or `https://` in a
  // URL never hides the code after it.
  const code = source
    .replaceAll(/(^|\s)\/\*[\s\S]*?\*\//g, (comment) => comment.replaceAll(/[^\n]/g, " "))
    .replaceAll(/(^|\s)\/\/.*$/gm, "$1");
  return code
    .split("\n")
    .flatMap((line, index) => (/\.(?:sort|toSorted)\(\s*\)/.test(line) ? [index + 1] : []));
}
