/** One numbered item of a review: the file and lines, the quote, then the comment. */
export interface ReviewItem {
  path: string;
  lineStart: number;
  lineEnd: number;
  quote: string;
  body: string;
}

/** The review as one message, each comment with its file, lines and quote. */
export function reviewMessage(_items: ReviewItem[]): string {
  return "";
}
