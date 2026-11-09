/**
 * The narrow windows of #641: `demo:shots` re-measures a set of prints at each size after the
 * 1280x800 one, resizing the same page. Only the dark prints do it: the width does not depend on
 * the theme, and both languages run (pt-BR strings are longer).
 */
export const NARROW_SIZES: ReadonlyArray<{ width: number; height: number }> = [
  { width: 1024, height: 700 },
  { width: 640, height: 800 },
  { width: 390, height: 844 },
];

/** The prints re-measured narrow: the pages #641 must bring to zero, and the ones with tables and tabs. */
export const NARROW_SHOTS: readonly string[] = [
  "hub",
  "inicio-kpis",
  "sessao",
  "host",
  "projeto-blocos",
  "board",
  "configuracoes",
  "card",
  "custos",
  "abas-muitas",
  // #784: simple mode's home scrolled sideways at 640 and 390.
  "simples-inicio",
  // #117: the board with the files panel; narrow, it gives the row back to the columns.
  "board-arquivos",
  // #168: the screens shipped on 2026-11-06 and 07.
  "projetos-novo",
  "times-apagar",
  // #1222: the new-team form and an active team, at every width.
  "times-novo",
  "times-rodando",
  // #1244: Merge PR's confirmation on a card with an open PR.
  "card-merge-pr",
  "workflows-modelos",
  "board-contrato",
  // #1052: the onboarding journey, the first screens a new person sees.
  "primeira-execucao",
  "host-novo",
  // #168, round 3: the surfaces shipped on 2026-11-07 and 08.
  "projeto-conhecimento",
  "card-novo-modelo",
  "claude-code-preparar",
  "card-fixados",
  // #1344: Needs you with the "While you were away" summary above its list.
  "precisa-de-voce-fora",
  // #1345: the Pull requests page, one row per open PR across the hosts.
  "pull-requests",
  // #1271: a Form dialog in the narrow sheet, its buttons at the sheet's bottom.
  "acoes-nova",
  // #1325, #1326: a card at a gate, with the empty spec file and hours rows and their reasons.
  "card-gate",
  // #1328: Settings > Backup schedule, waiting for the passphrase.
  "configuracoes-backup-agenda",
  // #1354: the selection bar and Start N's confirm, compact at 390.
  "board-selecao",
  "board-selecao-iniciar",
  // #1446: the second-opinion review on a card's Changes.
  "card-segunda-opiniao",
  // #1406: the bar and the board's notice after Update N from the base.
  "board-atualizar",
  // #1501: the Compare hosts table on the host page, a wide table in a sideways frame at 390.
  "host-comparar",
];

/** The sizes this print is re-measured at: none for a light print or a print not in the list. */
export function narrowSizes(
  theme: string,
  shot: string,
): ReadonlyArray<{ width: number; height: number }> {
  return theme === "dark" && NARROW_SHOTS.includes(shot) ? NARROW_SIZES : [];
}

/**
 * #677: the names in NARROW_SHOTS that are not prints of demo:shots, so a typo cannot skip one in
 * silence. demo:shots stops before Chrome starts when any is left.
 */
export function unknownNarrowShots(prints: readonly string[]): string[] {
  return NARROW_SHOTS.filter((name) => !prints.includes(name));
}
