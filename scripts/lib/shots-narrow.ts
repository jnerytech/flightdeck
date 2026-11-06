/**
 * The narrow windows of #641: `demo:shots` re-measures a set of prints at each size after the
 * 1280x800 one, resizing the same page. Only the dark prints do it: the width does not depend on
 * the theme, and both languages run (pt-BR strings are longer).
 */
export const NARROW_SIZES: ReadonlyArray<{ width: number; height: number }> = [];

/** The prints re-measured narrow: the pages #641 must bring to zero, and the ones with tables and tabs. */
export const NARROW_SHOTS: readonly string[] = [];

/** The sizes this print is re-measured at: none for a light print or a print not in the list. */
export function narrowSizes(
  _theme: string,
  _shot: string,
): ReadonlyArray<{ width: number; height: number }> {
  return [];
}
