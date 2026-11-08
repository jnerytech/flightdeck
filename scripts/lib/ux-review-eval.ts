/**
 * The eval of the `ux-reviewer` agent (issue #983, part of #169): `scripts/ux-review-eval.ts`
 * commits one known-bad UI change per case in a throwaway clone, runs the agent headless on it,
 * and these deterministic checks read its report. No model grades a model here.
 */
import type { EvalOptions } from "./harness-eval.ts";

/** What the agent's report must name for a case to pass; null: a clean change, no high finding. */
export interface UxExpect {
  /** The file, or the part of its name, that the finding's line names. */
  file: string;
  /** The line the finding is on; null when the words alone name it (a dictionary key). */
  line: number | null;
  /** At least one of these words is on the finding's line, any case. */
  words: string[];
}

/** One file a case writes: a new file, or lines inserted after an anchor line of an existing one. */
interface CaseFile {
  path: string;
  content: string;
  /** The whole line the content goes after; absent for a new file. */
  after?: string;
}

export interface UxCase {
  name: string;
  subject: string;
  files: CaseFile[];
  expect: UxExpect | null;
}

/** The cases, each one known-bad UI change (or a clean one) the agent must judge right. */
export const UX_CASES: UxCase[] = [];

/** The files a case writes, with their new text; or why it cannot apply (an anchor not found). */
export function applyCase(
  _uxCase: UxCase,
  _read: (path: string) => string | null,
): { writes: { path: string; text: string }[] } | string {
  return { writes: [] };
}

/** The final text of a `--output-format stream-json` run: its result event's text, or "". */
export function reportOf(_jsonl: string): string {
  return "";
}

/** Whether the report judged the case right. */
export function gradeReport(_expect: UxExpect | null, _report: string): boolean {
  return false;
}

/** The prompt of one review. */
export function reviewPrompt(_base: string): string {
  return "";
}

/** The `claude -p` arguments of one review. */
export function reviewArgs(
  _prompt: string,
  _options: Pick<EvalOptions, "model" | "budget">,
  _places: { dir: string; home: string },
): string[] {
  return [];
}

/** One line per case: how many samples judged it right. */
export function uxScorecard(_results: { name: string; passed: boolean[] }[]): string {
  return "";
}
