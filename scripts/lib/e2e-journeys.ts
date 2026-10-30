/** The end-to-end journeys, the languages they run in and the window sizes they are checked at. */
export const JOURNEYS: readonly string[] = [
  "aprovar-bash-com-a",
  "sessao-e-mensagem",
  "card-diff",
  "revisao-comentar-e-enviar",
  "paleta-e-leitor",
  "tema-e-idioma",
  "voltar-arquivos",
];

export const LANGUAGES: readonly string[] = ["pt-BR", "en"];

export const VIEWPORTS: ReadonlyArray<{ width: number; height: number }> = [
  { width: 1280, height: 800 },
  { width: 800, height: 600 },
];
