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

/** The question for a permission request: a sentence and its consequence, never a tool or a command. */
export function plainQuestion(
  _request: QuestionRequest,
  _language: QuestionLanguage,
): PlainQuestion {
  return { kind: "run", sentence: "", consequence: "", reversible: true };
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
export function questionPolicy(_input: QuestionPolicyInput): QuestionPolicy {
  return { outcome: "ask", hold: false, allowForSession: true, escapeDenies: false };
}
