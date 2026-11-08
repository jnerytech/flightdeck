/**
 * The eval of the `ux-reviewer` agent (issue #983, part of #169): `scripts/ux-review-eval.ts`
 * commits one known-bad UI change per case in a throwaway clone, runs the agent headless on it,
 * and these deterministic checks read its report. No model grades a model here.
 */
import { type EvalOptions, homeDenials } from "./harness-eval.ts";

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

const EN = "apps/desktop/src/i18n/en.ts";
const PT = "apps/desktop/src/i18n/pt-BR.ts";
const EN_ANCHOR = "export const en: Dictionary = {";
const PT_ANCHOR = "export const ptBR = {";

const DRAFT_BANNER = `import { memo } from "react";

/** The banner over a draft that is not saved yet. */
export const DraftBanner = memo(function DraftBanner({ onSave }: { onSave: () => void }) {
  return (
    <div role="status">
      <span>Your draft is not saved yet.</span>
      <button type="button" onClick={onSave}>
        Save
      </button>
    </div>
  );
});
`;

const FILTER_CHIP = `import { memo } from "react";
import type { Dictionary } from "../i18n/index.ts";

/** A chip that removes one filter. */
export const FilterChip = memo(function FilterChip({
  t,
  onRemove,
}: {
  t: Dictionary;
  onRemove: () => void;
}) {
  return (
    <button type="button" className="rounded-full px-2 outline-none" onClick={onRemove}>
      {t.nav.back}
    </button>
  );
});
`;

/** The cases, each one known-bad UI change (or a clean one) the agent must judge right. */
export const UX_CASES: UxCase[] = [
  {
    name: "literal",
    subject: "feat(draft): banner over an unsaved draft",
    files: [{ path: "apps/desktop/src/ui/DraftBanner.tsx", content: DRAFT_BANNER }],
    expect: {
      file: "apps/desktop/src/ui/DraftBanner.tsx",
      line: 7,
      words: ["literal", "dictionar", "i18n", "hardcoded", "hard-coded"],
    },
  },
  {
    name: "missing-pt-br",
    subject: "feat(draft): the save draft label",
    files: [{ path: EN, after: EN_ANCHOR, content: '  evalDraft: { save: "Save draft" },' }],
    // The finding names the dictionary that lacks the key, with or without ".ts".
    expect: { file: "pt-BR", line: null, words: ["evalDraft"] },
  },
  {
    name: "no-focus",
    subject: "feat(filters): a chip that removes a filter",
    files: [{ path: "apps/desktop/src/ui/FilterChip.tsx", content: FILTER_CHIP }],
    expect: { file: "apps/desktop/src/ui/FilterChip.tsx", line: 13, words: ["focus"] },
  },
  {
    name: "clean",
    subject: "feat(draft): the save draft label in both languages",
    files: [
      { path: PT, after: PT_ANCHOR, content: '  evalDraft: { save: "Salvar rascunho" },' },
      { path: EN, after: EN_ANCHOR, content: '  evalDraft: { save: "Save draft" },' },
    ],
    expect: null,
  },
];

/** The files a case writes, with their new text; or why it cannot apply (an anchor not found). */
export function applyCase(
  uxCase: UxCase,
  read: (path: string) => string | null,
): { writes: { path: string; text: string }[] } | string {
  const writes: { path: string; text: string }[] = [];
  for (const file of uxCase.files) {
    if (file.after === undefined) {
      writes.push({ path: file.path, text: file.content });
      continue;
    }
    const lines = (read(file.path) ?? "").split("\n");
    const at = lines.indexOf(file.after);
    if (at < 0) return `ux-review-eval: ${file.path} has no line "${file.after}"`;
    lines.splice(at + 1, 0, file.content);
    writes.push({ path: file.path, text: lines.join("\n") });
  }
  return { writes };
}

/** The final text of a `--output-format stream-json` run: its result event's text, or "". */
export function reportOf(jsonl: string): string {
  let text = "";
  for (const line of jsonl.split("\n")) {
    try {
      const event = JSON.parse(line) as { type?: unknown; result?: unknown };
      if (event.type === "result" && typeof event.result === "string") text = event.result;
    } catch {
      // Not a JSON line: the stream also carries blank lines.
    }
  }
  return text;
}

/** A table row of the report that marks a high finding. */
const HIGH_ROW = /\|\s*\**high\**\s*\|/i;

/** Escapes a path for a regex. */
function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether the report judged the case right: a clean change has no high finding; a bad one has a
 * line of the report that names the file (at the expected line, give or take 2) and one of the
 * words.
 */
export function gradeReport(expect: UxExpect | null, report: string): boolean {
  const lines = report.split("\n");
  if (expect === null) return report.trim() !== "" && !lines.some((line) => HIGH_ROW.test(line));
  const base = expect.file.slice(expect.file.lastIndexOf("/") + 1);
  const at = new RegExp(`${escaped(base)}(?::(\\d+))?`);
  return lines.some((line) => {
    const hit = at.exec(line);
    if (!hit) return false;
    if (expect.line !== null && Math.abs(Number(hit[1] ?? -99) - expect.line) > 2) return false;
    const lower = line.toLowerCase();
    return expect.words.some((word) => lower.includes(word.toLowerCase()));
  });
}

/** The prompt of one review: the worktree is the clone, the base the commit before the case. */
export function reviewPrompt(base: string, _diff: string): string {
  return [
    `Review the UI change of this worktree against the base ${base}.`,
    "Report as your Output section says.",
  ].join(" ");
}

/** The tools a review may use: reading the clone, read-only git and the area tests. */
const REVIEW_TOOLS = [
  "Read(./**)",
  "Bash(git log *)",
  "Bash(git show *)",
  "Bash(git diff *)",
  "Bash(bun --config=bunfig.area.toml test *)",
];

/**
 * The `claude -p` arguments of one review: the session is the `ux-reviewer` agent, with no Edit
 * or Write, and the home folder denied when the clone is outside it.
 */
export function reviewArgs(
  prompt: string,
  options: Pick<EvalOptions, "model" | "budget">,
  places: { dir: string; home: string },
): string[] {
  return [
    "-p",
    prompt,
    "--agent",
    "ux-reviewer",
    "--model",
    options.model,
    "--max-budget-usd",
    options.budget,
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--allowedTools",
    ...REVIEW_TOOLS,
    "--disallowedTools",
    "Edit",
    "Write",
    "NotebookEdit",
    "Bash(git push *)",
    "Bash(git remote *)",
    ...homeDenials(places),
  ];
}

/** One line per case: how many samples judged it right. */
export function uxScorecard(results: { name: string; passed: boolean[] }[]): string {
  return results
    .map(({ name, passed }) => {
      const good = passed.filter(Boolean).length;
      return `${name.padEnd(14)} ${good}/${passed.length}${good === passed.length ? "" : "  FAIL"}`;
    })
    .join("\n");
}
