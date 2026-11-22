# Comandos do flightdeckd: arquivos de configuração de agentes

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-agentcfg-commands.md)

Os verbos que leem e escrevem os arquivos `CLAUDE.md`, os agentes e as skills de um projeto. Funcionam como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum).

## fd agentcfg

```sh
fd agentcfg list api --kind agent
fd agentcfg read api --kind agent --path .claude/agents/reviewer.md
fd agentcfg write api --kind agent --path .claude/agents/reviewer.md --file next.md --expected-hash <hash> --confirm
fd agentcfg write api --kind skill --path .claude/skills/lint/SKILL.md --file - --new --confirm < SKILL.md
```

Os comandos por trás da tela Configuração de agentes: os arquivos `CLAUDE.md`, os agentes e as skills de um
projeto. `--kind` é `claudemd`, `agent` ou `skill`. O projeto é o nome ou o id. Use `--host <nome>` para um
host pareado e `--json` para um valor com chaves estáveis.

- **`list`:** um arquivo por linha: o caminho, de onde vem (`project` ou `user`), `editable` ou `read-only`, o
  hash, e o nome e a descrição quando tem. Um tipo sem arquivos avisa, e `--json` imprime `{"items": []}`.
- **`read --path <arquivo>`:** o caminho, a origem e o acesso do arquivo, depois `hash: <hash>`, uma linha em
  branco e o conteúdo. `--origin user` lê um arquivo do seu `~/.claude` em vez do projeto. Com `--json`
  imprime o item e o `content`, exato. No texto, os caracteres de controle do conteúdo viram espaços, então um
  arquivo não move o cursor do terminal nem troca o título da janela.
- **`write --path <arquivo> --file <caminho> --expected-hash <hash> --confirm`:** troca o arquivo pelo conteúdo
  de `--file` (`--file -` lê a entrada padrão). O hash é o que o `read` imprimiu: a escrita é recusada com
  `agentcfg_changed` quando o arquivo mudou desde então, então você nunca sobrescreve uma mudança que não viu.
  O CLI nunca lê o hash por você. Para criar um arquivo que ainda não pode existir, passe `--new` no lugar do
  hash; um arquivo que já existe é recusado com `agentcfg_exists`. Imprime o hash novo; com `--json`, `kind`,
  `path` e `hash`. Uma escrita pede uma conexão próxima: um agente ou uma skill pode declarar hooks que rodam um
  comando, e um `CLAUDE.md` orienta toda sessão do projeto, então por uma conexão distante (não este computador nem o
  Tailscale) o daemon a recusa com `transport_refused`. A leitura responde de qualquer lugar.

O daemon guarda todas as regras: um caminho fora do projeto ou fora das pastas daquele tipo, um frontmatter
ausente ou inválido e os arquivos somente leitura do `~/.claude` são recusados com as palavras dele, e o CLI
sai com `1`. Uma escrita que fica sem resposta sai com `2` e avisa que o arquivo pode ou não ter mudado: leia
de novo com `read` antes de escrever outra vez. Rodado no shell de uma sessão, `agentcfg write` é um comando de
risco alto: toda sessão seguinte do projeto lê o arquivo como instrução própria, e `--confirm` e o hash são só
palavras digitadas. `list` e `read` continuam comuns.
