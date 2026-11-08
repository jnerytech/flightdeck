/** One numbered item of a review: the file and lines, the quote, then the comment. */
export interface ReviewItem {
  path: string;
  lineStart: number;
  lineEnd: number;
  quote: string;
  body: string;
}

/** The language a review is written in: the app's, English when it does not say. */
export type ReviewLanguage = "en" | "pt-BR";

const WORDS = {
  en: { header: "Review of the changes:", line: "line", lines: "lines" },
  "pt-BR": { header: "Revisão das mudanças:", line: "linha", lines: "linhas" },
} as const;

/** `line 4` or `lines 10–12` (`linha 4`, `linhas 10–12`). */
const linesLabel = (start: number, end: number, language: ReviewLanguage) =>
  start === end ? `${WORDS[language].line} ${start}` : `${WORDS[language].lines} ${start}–${end}`;

/** The lines of a text, without the one a final line break leaves behind. */
const linesOf = (text: string) => text.replace(/\r?\n$/, "").split(/\r?\n/);

const indent = (prefix: string, text: string) =>
  linesOf(text)
    .map((line) => `${prefix}${line}`)
    .join("\n");

/** The review as one message, each comment with its file, lines and quote. */
export function reviewMessage(items: ReviewItem[], language: ReviewLanguage = "en"): string {
  return [
    WORDS[language].header,
    ...items.map((item, i) =>
      [
        `${i + 1}. \`${item.path}\` ${linesLabel(item.lineStart, item.lineEnd, language)}:`,
        indent("   > ", item.quote),
        indent("   ", item.body),
      ].join("\n"),
    ),
  ].join("\n");
}
