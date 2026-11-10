# Aprovações e permitir sempre

[Voltar ao manual](../pt-BR.md) · [English](../en/approvals-and-always-allow.md)

Além de Aprovar e Negar, uma aprovação, de sessão gerenciada ou do terminal, oferece:

- **Permitir nesta sessão:** aparece quando o Claude Code sugere permissões de destino `session`,
  que só valem para aquela sessão.
- **Sempre neste projeto:** abre a regra para edição antes de mandar.
  - No Bash, o padrão é o comando exato, que você pode trocar por um prefixo como `npm test:*`.
  - Nas outras ferramentas, o padrão é o nome da ferramenta.
  - Uma regra que nomeia uma pasta, ou um caminho que ainda não existe, é recusada: cobriria tudo
    que há dentro. Uma busca numa pasta (Grep, Glob) não oferece este botão; a mensagem pede para
    nomear um arquivo.
  - A regra vai para `<projeto>/.claude/settings.local.json`, o arquivo local, não versionado, do
    Claude Code.

O daemon só aceita uma das sugestões do próprio pedido (destinos `session` ou `localSettings`) ou
uma regra do projeto para a mesma ferramenta, com até 500 caracteres e sem quebra de linha.

- **Recusados:** `userSettings` (o `~/.claude/settings.json`), `projectSettings` (o
  `.claude/settings.json` versionado), `cliArg` e os modos `bypassPermissions` e `auto`.
- **Na recusa:** o app mostra o erro, e o pedido continua aberto.

Cards rodam em worktrees, e cada worktree tem o próprio `.claude`:

- uma regra aceita numa sessão de card (ou de uma etapa de workflow) também é gravada no
  `.claude/settings.local.json` da raiz do repositório, sem duplicar e sem tocar nas outras
  chaves;
- toda worktree nova recebe uma cópia do arquivo da raiz, a menos que o repositório o versione;
- `.claude/settings.local.json` entra no `.git/info/exclude` do repositório, então nunca aparece
  no diff de um card nem num commit.

Na tela Projetos, **Editar** mostra a seção **Regras** do projeto, com o botão de remover, que
pede confirmação e preserva o resto do arquivo.
