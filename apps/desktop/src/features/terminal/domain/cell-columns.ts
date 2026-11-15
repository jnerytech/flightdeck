/** A row of xterm's buffer: its text, and its cells (a wide character takes two, the second empty). */
export interface XtermBufferLine {
  length: number;
  getCell(x: number): { getChars(): string; getWidth(): number } | undefined;
  translateToString(trimRight?: boolean): string;
}

/**
 * The cell each character of a row's text starts in: the text's indexes and the columns part ways
 * after a wide character (a CJK letter, some emoji), where one character takes two cells.
 */
export function cellColumns(line: XtermBufferLine): number[] {
  const columns: number[] = [];
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    if (!cell || cell.getWidth() === 0) continue;
    const chars = cell.getChars() || " ";
    for (let unit = 0; unit < chars.length; unit++) columns.push(x); // NOSONAR: one column per UTF-16 unit; for...of would walk code points
  }
  return columns;
}
