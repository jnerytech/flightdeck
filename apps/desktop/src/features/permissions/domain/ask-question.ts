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
export function parseQuestions(input: Record<string, unknown>): AskQuestion[] | null {
  const list = input.questions;
  if (!Array.isArray(list) || list.length === 0) return null;
  const questions: AskQuestion[] = [];
  for (const raw of list) {
    const item = raw as Record<string, unknown> | null;
    if (!item || typeof item.question !== "string" || !Array.isArray(item.options ?? [])) {
      return null;
    }
    const options: AskQuestion["options"] = [];
    for (const option of (item.options ?? []) as Array<Record<string, unknown> | null>) {
      if (!option || typeof option.label !== "string") return null;
      options.push({
        label: option.label,
        description: typeof option.description === "string" ? option.description : "",
      });
    }
    questions.push({
      question: item.question,
      header: typeof item.header === "string" ? item.header : "",
      multiSelect: item.multiSelect === true,
      options,
    });
  }
  return questions;
}

/** The `answers` map the tool expects: question text to the chosen labels (joined by ", ") or the Other text. */
/** What one question answers with: the labels and the Other text, or for a single choice the text alone. */
function answerParts(multiSelect: boolean, labels: string[], other: string): string[] {
  if (multiSelect) return [...labels, ...(other ? [other] : [])];
  return other ? [other] : labels.slice(0, 1);
}

export function buildAnswers(
  questions: AskQuestion[],
  picks: Record<string, AskPick>,
): Record<string, string> | null {
  const answers: Record<string, string> = {};
  for (const { question, multiSelect } of questions) {
    const pick = picks[question];
    const other = pick?.other.trim() ?? "";
    // A single choice with an Other text answers with the text alone.
    const parts = answerParts(multiSelect, pick?.labels ?? [], other);
    if (parts.length === 0) return null;
    answers[question] = parts.join(", ");
  }
  return answers;
}

/** The input the tool runs with: the original one plus `answers`. */
export function answeredInput(
  input: Record<string, unknown>,
  answers: Record<string, string>,
): Record<string, unknown> {
  return { ...input, answers };
}
