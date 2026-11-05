import type { Lang } from "../i18n/index.ts";

/** Words that never show in simple mode (phase 33): the app's technical vocabulary. */
export const HIDDEN_TERMS: Record<Lang, readonly string[]> = {
  en: [
    "tool",
    "bash",
    "json",
    "worktree",
    "branch",
    "hook",
    "hooks",
    "mcp",
    "plugin",
    "plugins",
    "vault",
    "terminal",
    "token",
    "tokens",
    "cost",
    "costs",
    "budget",
    "persona",
    "personas",
    "session",
    "sessions",
    "host",
    "hosts",
    "project",
    "projects",
    "permission",
  ],
  "pt-BR": [
    "ferramenta",
    "bash",
    "json",
    "worktree",
    "branch",
    "hook",
    "hooks",
    "mcp",
    "plugin",
    "plugins",
    "cofre",
    "terminal",
    "token",
    "tokens",
    "custo",
    "custos",
    "orçamento",
    "persona",
    "personas",
    "sessão",
    "sessões",
    "host",
    "hosts",
    "projeto",
    "projetos",
    "permissão",
  ],
};

/** The hidden terms a text holds, whole words, whatever the case. */
export function hiddenTermsIn(text: string, lang: Lang): string[] {
  return HIDDEN_TERMS[lang].filter((term) =>
    new RegExp(String.raw`(?<![\p{L}\p{N}])${term}(?![\p{L}\p{N}])`, "iu").test(text),
  );
}
