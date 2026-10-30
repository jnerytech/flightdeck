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
];

export const LANGUAGES: readonly string[] = ["pt-BR", "en"];

/**
 * The versioned action the acoes journey trusts, one per language: the demo keeps its state
 * between runs, so the second language would find the first one's already trusted.
 */
export const ACOES_ACTION: Readonly<Record<string, string>> = { "pt-BR": "versao", en: "version" };

export const VIEWPORTS: ReadonlyArray<{ width: number; height: number }> = [
  { width: 1280, height: 800 },
  { width: 800, height: 600 },
];
