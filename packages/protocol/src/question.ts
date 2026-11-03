/** How a permission request reads to someone who does not use a terminal (phase 33). */
export type QuestionLanguage = "en" | "pt-BR";

export type QuestionKind =
  | "create"
  | "replace"
  | "change"
  | "delete"
  | "move"
  | "copy"
  | "read"
  | "web"
  | "helper"
  | "run";

export interface QuestionRequest {
  toolName: string;
  input: unknown;
  risk?: "low" | "medium" | "high";
  /** For a file the request writes: whether it is there already (the daemon looks). */
  fileExists?: boolean;
}

export interface PlainQuestion {
  kind: QuestionKind;
  /** What Claude wants to do, in one sentence. */
  sentence: string;
  /** What that means for the person's things, in one line. */
  consequence: string;
  /** Whether the person could get back what was there; false for replace and delete. */
  reversible: boolean;
}

const SEP = /[\\/]/;
const baseName = (path: string) => path.split(SEP).filter(Boolean).at(-1) ?? path;
/** The folder a path sits in, by name; empty when it has none. */
const folderName = (path: string) => path.split(SEP).filter(Boolean).at(-2) ?? "";

const WORDS = {
  en: {
    and: "and",
    more: (n: number) => `and ${n} more`,
    create: (name: string, folder: string) =>
      `Create the file ${name}${folder ? ` in ${folder}` : ""}`,
    createNote: "This adds a new file. Nothing existing changes.",
    replace: (name: string) => `Replace the contents of ${name}`,
    undone: "This cannot be undone.",
    change: (name: string) => `Change part of ${name}`,
    changeNote: "This changes the file. The rest of it stays.",
    del: (things: string) => `Delete ${things}`,
    move: (what: string, where: string) => `Move ${what} to ${where}`,
    moveNote: "This moves things. Nothing is lost.",
    copy: (what: string, where: string) => `Copy ${what} to ${where}`,
    copyNote: "This adds a copy. The original stays.",
    read: (name: string) => (name ? `Read the file ${name}` : "Look through your files"),
    readNote: "Nothing changes.",
    web: "Look something up on the internet",
    webNote: "Nothing on this computer changes.",
    helper: "Start a helper for part of the task",
    helperNote: "It works in the same folder, with the same questions.",
    run: "Run a step on this computer",
    runLow: "It should not change anything important.",
    runMedium: "It may change files on this computer.",
    runHigh: "This can change or remove things and may not be undoable.",
  },
  "pt-BR": {
    and: "e",
    more: (n: number) => `e mais ${n}`,
    create: (name: string, folder: string) =>
      `Criar o arquivo ${name}${folder ? ` em ${folder}` : ""}`,
    createNote: "Isto adiciona um arquivo novo. Nada do que existe muda.",
    replace: (name: string) => `Substituir o conteúdo de ${name}`,
    undone: "Isto não pode ser desfeito.",
    change: (name: string) => `Alterar uma parte de ${name}`,
    changeNote: "Isto altera o arquivo. O resto dele fica como está.",
    del: (things: string) => `Apagar ${things}`,
    move: (what: string, where: string) => `Mover ${what} para ${where}`,
    moveNote: "Isto move as coisas. Nada se perde.",
    copy: (what: string, where: string) => `Copiar ${what} para ${where}`,
    copyNote: "Isto adiciona uma cópia. O original fica.",
    read: (name: string) => (name ? `Ler o arquivo ${name}` : "Olhar os seus arquivos"),
    readNote: "Nada muda.",
    web: "Pesquisar algo na internet",
    webNote: "Nada neste computador muda.",
    helper: "Chamar um ajudante para uma parte da tarefa",
    helperNote: "Ele trabalha na mesma pasta, com as mesmas perguntas.",
    run: "Executar uma etapa neste computador",
    runLow: "Isso não deve mudar nada importante.",
    runMedium: "Isso pode mudar arquivos neste computador.",
    runHigh: "Isso pode alterar ou remover coisas e talvez não dê para desfazer.",
  },
} as const;

type Words = (typeof WORDS)[QuestionLanguage];

/** "a", "a and b", "a, b and c", "a, b, c and 2 more". */
function listOf(names: string[], words: Words): string {
  if (names.length <= 3) {
    return names.length < 2
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} ${words.and} ${names.at(-1)}`;
  }
  return `${names.slice(0, 3).join(", ")} ${words.more(names.length - 3)}`;
}

const text = (value: unknown, key: string): string => {
  const found = (value as Record<string, unknown> | null | undefined)?.[key];
  return typeof found === "string" ? found : "";
};

/** A destination as a person says it: the folder it is in, else its own name. */
const placeOf = (path: string) =>
  SEP.test(path.trim()) ? folderName(path) || baseName(path) : path.trim();

/** One simple command (no chaining, pipes, redirects or substitutions) as its verb and operands. */
function simpleCommand(command: string): { verb: string; args: string[] } | null {
  if (/[;&|<>`$()\n]/.test(command)) return null;
  const parts = command.trim().split(/\s+/).filter(Boolean);
  const verb = parts[0]?.toLowerCase();
  if (!verb) return null;
  return { verb, args: parts.slice(1).filter((part) => !part.startsWith("-")) };
}

function fromCommand(command: string, words: Words): PlainQuestion | null {
  const parsed = simpleCommand(command);
  if (!parsed || parsed.args.length === 0) return null;
  const { verb, args } = parsed;
  if (["rm", "rmdir", "del", "erase", "remove-item"].includes(verb)) {
    return {
      kind: "delete",
      sentence: words.del(listOf(args.map(baseName), words)),
      consequence: words.undone,
      reversible: false,
    };
  }
  if (["mv", "move", "ren", "rename"].includes(verb) && args.length >= 2) {
    const target = args.at(-1) as string;
    return {
      kind: "move",
      sentence: words.move(listOf(args.slice(0, -1).map(baseName), words), placeOf(target)),
      consequence: words.moveNote,
      reversible: true,
    };
  }
  if (["cp", "copy"].includes(verb) && args.length >= 2) {
    const target = args.at(-1) as string;
    return {
      kind: "copy",
      sentence: words.copy(listOf(args.slice(0, -1).map(baseName), words), placeOf(target)),
      consequence: words.copyNote,
      reversible: true,
    };
  }
  return null;
}

/** The question for a permission request: a sentence and its consequence, never a tool or a command. */
export function plainQuestion(request: QuestionRequest, language: QuestionLanguage): PlainQuestion {
  const words = WORDS[language];
  const { toolName, input } = request;
  const file = text(input, "file_path") || text(input, "notebook_path");
  if (toolName === "Write" && file) {
    return request.fileExists
      ? {
          kind: "replace",
          sentence: words.replace(baseName(file)),
          consequence: words.undone,
          reversible: false,
        }
      : {
          kind: "create",
          sentence: words.create(baseName(file), folderName(file)),
          consequence: words.createNote,
          reversible: true,
        };
  }
  if (["Edit", "MultiEdit", "NotebookEdit"].includes(toolName) && file) {
    return {
      kind: "change",
      sentence: words.change(baseName(file)),
      consequence: words.changeNote,
      reversible: false,
    };
  }
  if (toolName === "Bash") {
    const made = fromCommand(text(input, "command"), words);
    if (made) return made;
  }
  if (["Read", "Glob", "Grep", "LS"].includes(toolName)) {
    return {
      kind: "read",
      sentence: words.read(file ? baseName(file) : ""),
      consequence: words.readNote,
      reversible: true,
    };
  }
  if (["WebFetch", "WebSearch"].includes(toolName)) {
    return { kind: "web", sentence: words.web, consequence: words.webNote, reversible: true };
  }
  if (["Task", "Agent"].includes(toolName)) {
    return {
      kind: "helper",
      sentence: words.helper,
      consequence: words.helperNote,
      reversible: true,
    };
  }
  const risk = request.risk ?? "medium";
  return {
    kind: "run",
    sentence: words.run,
    consequence: risk === "high" ? words.runHigh : risk === "low" ? words.runLow : words.runMedium,
    reversible: risk !== "high",
  };
}

export interface QuestionPolicyInput extends QuestionRequest {
  /** The request opens the vault. */
  vault?: boolean;
  /** The request touches a production destination. */
  prod?: boolean;
}

export interface QuestionPolicy {
  /** `needs_full_access` means: do not show it, pause the task and say so. */
  outcome: "ask" | "needs_full_access";
  /** The yes button is held for two seconds. */
  hold: boolean;
  /** Never offered in simple mode: "allow for this session", rules, "always allow". */
  allowForSession: boolean;
  /** Esc and "No" both say no. */
  escapeDenies: boolean;
}

/** What simple mode does with a request. */
export function questionPolicy(input: QuestionPolicyInput): QuestionPolicy {
  return {
    outcome: input.vault || input.prod ? "needs_full_access" : "ask",
    hold: input.risk === "high",
    allowForSession: false,
    escapeDenies: true,
  };
}

/** The request in both languages, with what simple mode does with it: one source for every client. */
export function plainInfo(input: QuestionPolicyInput) {
  const en = plainQuestion(input, "en");
  const ptBr = plainQuestion(input, "pt-BR");
  const policy = questionPolicy(input);
  return {
    kind: en.kind,
    sentence: { en: en.sentence, "pt-BR": ptBr.sentence },
    consequence: { en: en.consequence, "pt-BR": ptBr.consequence },
    reversible: en.reversible,
    outcome: policy.outcome,
    hold: policy.hold,
  };
}
