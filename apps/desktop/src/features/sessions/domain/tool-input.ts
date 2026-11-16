import { flattenFields } from "@/shared/lib/index.ts";

const SUMMARY_KEYS = ["file_path", "command", "pattern", "path", "url", "description"];

/** The text of each question of an AskUserQuestion input; none for any other shape. */
function questionTexts(questions: unknown): string[] {
  if (!Array.isArray(questions)) return [];
  return questions.flatMap((q) =>
    q && typeof q === "object" && typeof (q as { question?: unknown }).question === "string"
      ? [(q as { question: string }).question]
      : [],
  );
}

/** One line about a tool input: its most telling field, or key and value pairs, cut at 80. */
export function inputSummary(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  const key = SUMMARY_KEYS.find((k) => typeof record[k] === "string");
  const asked = key ? [] : questionTexts(record.questions);
  const text = (() => {
    if (key) return String(record[key]);
    // AskUserQuestion: what is asked, not the question objects as JSON.
    if (asked.length > 0) return asked.join(" · ");
    return flattenFields(record)
      .map(([name, value]) => `${name}: ${value}`)
      .join(" · ");
  })();
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}
