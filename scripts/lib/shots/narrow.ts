/**
 * The narrow windows of #641: `demo:shots` re-measures a set of prints at each size after the
 * 1280x800 one, resizing the same page. Only the dark prints do it: the width does not depend on
 * the theme, and both languages run (pt-BR strings are longer).
 */
const NARROW_SIZES: ReadonlyArray<{ width: number; height: number }> = [
  { width: 1024, height: 700 },
  { width: 640, height: 800 },
  { width: 390, height: 844 },
];

/** The prints re-measured narrow: the pages #641 must bring to zero, and the ones with tables and tabs. */
export const NARROW_SHOTS: readonly string[] = [
  "hub",
  "inicio-kpis",
  "sessao",
  // #1870: a session waiting for an approval; its request's folder must stay inside the window.
  "sessao-aprovacao",
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
  // #4025: the footer of a running, a paused and a quota-paused team; it wraps at 390.
  "times-rodape",
  "times-adicionar",
  "times-pausado",
  "times-cota",
  // #4308: the Quota card's guard row and buttons, with one host and with a shared account.
  "cota-cartao-quente",
  "cota-cartao-trava-leitura",
  "cota-cartao-conta-compartilhada",
  // #4308: the status bar's quota popover, its guards and buttons, at 390.
  "cota-popover",
  // #4335: Connections: a row with its four buttons, the form and its test result, the changed-key dialog and the list states.
  "ssh-destinos",
  "ssh-editar",
  "ssh-editar-cofre",
  "ssh-teste-falhou",
  "ssh-chave-mudou",
  "ssh-sem-resultado",
  "ssh-importar-vazio",
  "ssh-sem-host",
  "ssh-lista-falhou",
  "ssh-lista-carregando",
  // #4348: Settings > Backup's Restore a backup with Google Drive: the source choice and the long file names.
  "configuracoes-restaurar-fonte",
  "configuracoes-restaurar-drive-entrar",
  "configuracoes-restaurar-drive-lista",
  "configuracoes-restaurar-drive-vazio",
  "configuracoes-restaurar-drive-auth",
  "configuracoes-restaurar-drive-falhou",
  // #4348: Scheduled backups with Google Drive as the target, and a Keep number that is not valid.
  "configuracoes-agendado-drive-saida",
  "configuracoes-agendado-drive-conectado",
  "configuracoes-agendado-drive-recusado",
  "configuracoes-agendado-drive-aguardando",
  "configuracoes-agendado-manter-invalido",
  // #4348: Back up everything refused: the form's fields, and the notice or the reason under them, narrow.
  "configuracoes-backup-erro-diferente",
  "configuracoes-backup-erro-curta",
  "configuracoes-backup-erro-grande",
  // #4348: Restore a backup refused (a restore that fails, nothing to restore) and a prune that fails: the notice or the reason beside the buttons narrows.
  "configuracoes-backup-restaurar-falhou",
  "configuracoes-backup-nada-a-restaurar",
  "configuracoes-agenda-limpeza-falhou",
  // #4348: Vault > Backup: the exported message, the preview, a wrong passphrase, the Replace dialog and the result.
  "cofre-backup-exportado",
  "cofre-backup-previa",
  "cofre-backup-frase-errada",
  "cofre-backup-substituir",
  "cofre-backup-resultado",
  // #1244: Merge PR's confirmation on a card with an open PR.
  "card-merge-pr",
  "workflows-modelos",
  // #4203: the bell's panel, its rows and their buttons, at every width.
  "sino-painel",
  "sino-recusa",
  "sino-alto-risco",
  "board-contrato",
  // #4252: the Timeline sheet and its refusals, the Undo dialog and an open long prompt, at every width.
  "linha-do-tempo",
  "linha-do-tempo-voltar-recusa-aplicar",
  "linha-do-tempo-voltar-lista-longa",
  "linha-do-tempo-arquivos-falhou",
  "linha-do-tempo-desfazer",
  "linha-do-tempo-prompt-longo-aberto",
  // #1052: the onboarding journey, the first screens a new person sees.
  "primeira-execucao",
  "host-novo",
  // #4388: New session on a host with no allowed folder; the reason and its link wrap at 390.
  "nova-sessao-sem-pasta",
  // #3886: its field errors and a refused token must fit the window too.
  "host-novo-campos",
  "host-novo-recusado",
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
  // #3999: the Maintenance panel's three buttons must wrap, not overflow, in the narrow window.
  "host-manutencao",
  // #4325: the Health & dependencies panel's missing tool, fixes and folded list, where a command and a path wrap.
  "host-saude",
  "host-saude-falta",
  "host-saude-correcoes",
  "host-saude-ok-aberto",
  // #4351: the Claude account card with every window, a long name, a failed read and a refresh under way.
  "host-conta-conectada",
  "host-conta-desconectada",
  "host-conta-desconhecida-erro",
  "host-conta-atualizando",
  // #1328: Settings > Backup schedule, waiting for the passphrase.
  "configuracoes-backup-agenda",
  // #1354: the selection bar and Start N's confirm, compact at 390.
  "board-selecao",
  "board-selecao-iniciar",
  // #1446: the second-opinion review on a card's Changes.
  "card-segunda-opiniao",
  "card-mudancas",
  "card-mudancas-dividido",
  "sessao-mudancas",
  // #1406: the bar and the board's notice after Update N from the base.
  "board-atualizar",
  // #4410: the board's load error, a filter with no match, the delete and discard dialogs, the column's New card, and the empty board, at 390.
  "board-erro",
  "board-filtro-vazio",
  "board-apagar",
  "board-apagar-iniciado",
  "board-descartar",
  "board-card-novo-coluna",
  "projeto-vazio",
  // #1501: the Compare hosts table on the host page, a wide table in a sideways frame at 390.
  "host-comparar",
  // #3858: the Automations list and the Workflows page.
  "automacoes-lista",
  "workflows",
  // #3956: the Installed tab, a long-named plugin with its chips, badge and four buttons in one row.
  "plugins",
  // #4059: What's new takes the whole window below 640 px; its footer is a plain column.
  "novidades",
  // #4243: the Activity board stacks its columns below 640 px.
  "atividade",
  // #4269: the MCP tab's form, test dialog and a long row must wrap at 390.
  "agente-mcp-novo",
  "agente-mcp-testar",
  "agente-mcp-linha-longa",
  // #4297: Conversations (also cut), and the Messaging rules with a long project path and long session ids, at 390.
  "conversas",
  "conversas-cortada",
  "configuracoes-mensagens-longos",
  // #4269: the Files tab's bad name, discard and stale states and the cut Context carry long text; they wrap at 390.
  "agente-skills-nome-invalido",
  "agente-agentes-descartar",
  "agente-agentes-obsoleto",
  "agente-contexto-cortado",
  // #4163: the permission screens; a long rule or reason must wrap at 390.
  "sessao-aprovacao-risco-alto",
  "projeto-regras",
  "aprovacoes-automaticas",
  // #4194: Costs with no cost and after a refused read, and the settings panel with its error.
  "custos-vazio",
  "custos-recusado",
  "custos-parcial",
  "custos-projeto-vazio",
  "roi-ajustes",
  "roi-ajustes-numero-ruim",
  // #4194: the filters in use, the export's refusal line, the quota charts and a budget being edited at 390.
  "custos-filtros",
  "custos-exportar-falhou",
  "custos-cota",
  "configuracoes-orcamentos-editar",
  // #4190: the Automations form's first step and its field errors at 390.
  "automacoes-gatilho",
  "automacoes-form-erros",
  // #4236: the Knowledge states that carry long text or a form at 390, and the Memory list and its
  // name error; the Agent tab strip wraps there (#4278).
  "projeto-conhecimento-avisos",
  "projeto-conhecimento-criar-erro",
  "agente-memoria",
  "agente-memoria-nome-erro",
  // #4287: the Run environment panel's states carry commands, a ports line and a process row with up to three buttons; they wrap at 390.
  "card-ambiente-revisar",
  "card-ambiente-confiar",
  "card-ambiente-confianca-recusada",
  "card-ambiente-erros",
  "card-ambiente-parado",
  "card-ambiente-setup",
  "card-ambiente-rodando",
  "card-ambiente-caiu",
  "card-ambiente-falhou",
  "card-ambiente-recusado",
  // #4287: the preview page and the workflow timeline's states: a long step line and the budget meter wrap at 390.
  "previa-ambiente",
  "previa-recusada",
  "card-run-rodando",
  "card-run-cota",
  "card-run-falhou",
  "card-run-tentativa",
  "card-run-passo-longo",
  // #4215: the Personas list, the editor of one, its field errors and the row with the most buttons; they wrap at 390.
  "personas",
  "personas-editor-existing",
  "personas-editor-errors",
  "personas-untrusted",
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
