/**
 * `text` without the characters of `chars` at its start, in one pass. A pattern like `^[…]+` is
 * fine, but its twin `[…]+$` tries again from every character of a run (Sonar S8786), so both
 * cuts are walked here.
 */
export function trimStartOf(text: string, chars: string): string {
  let start = 0;
  while (start < text.length && chars.includes(text[start] as string)) start++;
  return text.slice(start);
}

/** `text` without the characters of `chars` at its end, in one pass (see `trimStartOf`). */
export function trimEndOf(text: string, chars: string): string {
  let end = text.length;
  while (end > 0 && chars.includes(text[end - 1] as string)) end--;
  return text.slice(0, end);
}
