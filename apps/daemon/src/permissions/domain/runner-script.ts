const cache = new WeakMap<string[], number>();

/**
 * Where a runner's text first has a word that is neither an option nor the value of one (`--cwd <dir>`): the
 * script it runs, as in `bun --cwd d start` (#3718). The text's length when there is none. It is asked once for
 * each word of a line, so the answer is kept for the text.
 */
export function scriptIndex(words: string[]): number {
  const known = cache.get(words);
  if (known !== undefined) return known;
  const valueOfOption = (j: number) =>
    words[j - 1]?.startsWith("-") && !words[j - 1]?.includes("=");
  const at = words.findIndex((w, j) => !w.startsWith("-") && !valueOfOption(j));
  const index = at < 0 ? words.length : at;
  cache.set(words, index);
  return index;
}
