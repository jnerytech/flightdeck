/** The end-to-end journeys, the languages they run in and the window sizes they are checked at. */
export const JOURNEYS: readonly string[] = [
  "aprovar-bash-com-a",
  "sessao-e-mensagem",
  "card-diff",
  "revisao-comentar-e-enviar",
  "paleta-e-leitor",
  "tema-e-idioma",
  "voltar-arquivos",
  "issue-e-risco",
  "abas-terminal",
  "acoes",
  "regras",
  "mensagens",
  "clientes",
  "dependencias",
  "rolagem-fim",
];

export const LANGUAGES: readonly string[] = ["pt-BR", "en"];

/** The names the versioned actions are built from, one per language. */
const ACOES_BASE: Readonly<Record<string, string>> = { "pt-BR": "versao", en: "version" };

/** How many repeats of the acoes journey one demo can serve: each trusts an action of its own. */
export const ACOES_POOL = 8;

/**
 * The versioned action the acoes journey trusts in a language and repeat: the demo keeps its state
 * between runs, so a second run (the other language, or `--repeat-each`) would find it trusted.
 */
export function acoesAction(lang: string, repeat: number): string {
  return `${ACOES_BASE[lang]}-${repeat + 1}`;
}

/** Every action the demo seeds for the acoes journey. */
export function acoesActions(): string[] {
  return LANGUAGES.flatMap((lang) =>
    Array.from({ length: ACOES_POOL }, (_, repeat) => acoesAction(lang, repeat)),
  );
}

export const VIEWPORTS: ReadonlyArray<{ width: number; height: number }> = [
  { width: 1280, height: 800 },
  { width: 800, height: 600 },
];

/** The name of the demo session that holds the high-risk request (the issue-e-risco journey). */
export const DANGER_SESSION = "Limpar a pasta build";
