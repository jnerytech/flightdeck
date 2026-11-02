/** One question of Claude's AskUserQuestion tool. */
export interface AskQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: Array<{ label: string; description: string }>;
}

/** What the user picked for one question: option labels and/or a free "Other" text. */
export interface AskPick {
  labels: string[];
  other: string;
}

/** The questions of an AskUserQuestion input; `null` when the input is not shaped like one. */
export function parseQuestions(_input: Record<string, unknown>): AskQuestion[] | null {
  return [];
}

/** The `answers` map the tool expects: question text to the chosen labels (joined by ", ") or the Other text. */
export function buildAnswers(
  _questions: AskQuestion[],
  _picks: Record<string, AskPick>,
): Record<string, string> | null {
  return {};
}

/** The input the tool runs with: the original one plus `answers`. */
export function answeredInput(
  input: Record<string, unknown>,
  _answers: Record<string, string>,
): Record<string, unknown> {
  return input;
}
