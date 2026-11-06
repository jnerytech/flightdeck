import type { QuestionLanguage } from "./question.ts";

/** One tool call of a task, as the session recorded it. */
export interface ToolEvent {
  name: string;
  input: unknown;
}

export type ActivityKind = "reading" | "searching" | "writing" | "running" | "thinking" | "idle";

export interface TaskActivity {
  kind: ActivityKind;
  /** How many things the latest burst touched (files for reading and writing, steps otherwise). */
  count: number;
  /** One live sentence, never a tool name. */
  text: string;
}

const READ = new Set(["Read"]);
const SEARCH = new Set(["Grep", "Glob", "LS"]);
const WRITE = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

const kindOf = (name: string): ActivityKind => {
  if (READ.has(name)) return "reading";
  if (SEARCH.has(name)) return "searching";
  return WRITE.has(name) ? "writing" : "running";
};

/** " in <folder>" (with the language's preposition), or nothing without a folder. */
const within = (preposition: string, folder: string) => (folder ? ` ${preposition} ${folder}` : "");

const SEP = /[\\/]/;
const parts = (path: string) => path.split(SEP).filter(Boolean);
const pathOf = (event: ToolEvent): string => {
  const input = event.input as Record<string, unknown> | null | undefined;
  const found = input?.file_path ?? input?.notebook_path;
  return typeof found === "string" ? found : "";
};

const WORDS = {
  en: {
    reading: (n: number, name: string, folder: string) =>
      n === 1 && name ? `Reading ${name}` : `Reading ${n} files${within("in", folder)}`,
    writing: (n: number, name: string, folder: string) =>
      n === 1 && name ? `Writing ${name}` : `Writing ${n} files${within("in", folder)}`,
    searching: "Looking through your files",
    running: (n: number) => (n === 1 ? "Working on a step" : `Working on ${n} steps`),
    thinking: "Thinking",
    idle: "Not doing anything right now",
  },
  "pt-BR": {
    reading: (n: number, name: string, folder: string) =>
      n === 1 && name ? `Lendo ${name}` : `Lendo ${n} arquivos${within("em", folder)}`,
    writing: (n: number, name: string, folder: string) =>
      n === 1 && name ? `Escrevendo ${name}` : `Escrevendo ${n} arquivos${within("em", folder)}`,
    searching: "Olhando os seus arquivos",
    running: (n: number) => (n === 1 ? "Trabalhando em uma etapa" : `Trabalhando em ${n} etapas`),
    thinking: "Pensando",
    idle: "Sem fazer nada agora",
  },
} as const;

/** What a task is doing, from its tool calls in order (the last one is the latest). */
export function taskActivity(
  tools: readonly ToolEvent[],
  language: QuestionLanguage,
  working: boolean,
): TaskActivity {
  const words = WORDS[language];
  if (!working) return { kind: "idle", count: 0, text: words.idle };
  const last = tools.at(-1);
  if (!last) return { kind: "thinking", count: 0, text: words.thinking };
  const kind = kindOf(last.name);
  // The latest burst: the calls at the end that are of the same kind.
  const burst: ToolEvent[] = [];
  for (let i = tools.length - 1; i >= 0 && kindOf((tools[i] as ToolEvent).name) === kind; i--) {
    burst.unshift(tools[i] as ToolEvent);
  }
  if (kind === "searching") return { kind, count: burst.length, text: words.searching };
  if (kind === "running") return { kind, count: burst.length, text: words.running(burst.length) };
  const paths = [...new Set(burst.map(pathOf).filter(Boolean))];
  const count = paths.length > 0 ? paths.length : burst.length;
  const folders = new Set(paths.map((path) => parts(path).at(-2) ?? ""));
  const folder = folders.size === 1 ? ([...folders][0] ?? "") : "";
  const name = paths.length === 1 ? (parts(paths[0] as string).at(-1) ?? "") : "";
  const say = kind === "reading" ? words.reading : words.writing;
  return { kind, count, text: say(count, name, folder) };
}
