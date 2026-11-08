/** One numbered item of a review: the file and lines, the quote, then the comment. */
export interface ReviewItem {
  path: string;
  lineStart: number;
  lineEnd: number;
  quote: string;
  body: string;
}

/** `linha 4` or `linhas 10–12`. */
const linesLabel = (start: number, end: number) =>
  start === end ? `linha ${start}` : `linhas ${start}–${end}`;

/** The lines of a text, without the one a final line break leaves behind. */
const linesOf = (text: string) => text.replace(/\r?\n$/, "").split(/\r?\n/);

const indent = (prefix: string, text: string) =>
  linesOf(text)
    .map((line) => `${prefix}${line}`)
    .join("\n");

/** The review as one message, each comment with its file, lines and quote. */
export function reviewMessage(items: ReviewItem[]): string {
  return [
    "Revisão das mudanças:",
    ...items.map((item, i) =>
      [
        `${i + 1}. \`${item.path}\` ${linesLabel(item.lineStart, item.lineEnd)}:`,
        indent("   > ", item.quote),
        indent("   ", item.body),
      ].join("\n"),
    ),
  ].join("\n");
}
