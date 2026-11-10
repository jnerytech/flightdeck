# Histórico

[Voltar ao manual](../pt-BR.md) · [English](../en/history.md)

O daemon de cada host indexa os transcripts do Claude Code desse host, inclusive as sessões que
nasceram fora do Flightdeck (terminal, VS Code, Desktop). Os transcripts são só lidos: nada é
editado, apagado ou copiado entre hosts. A única escrita em `~/.claude` é a dos hooks, por
comando explícito (veja [Hooks do Claude Code](session-hub-and-claude-code-hooks.md#hooks-do-claude-code)).

## O que é indexado

- Cada arquivo `<id>.jsonl` em `~/.claude/projects/<pasta>/` é uma sessão; o id é o
  `claudeSessionId`. A pasta do projeto vem do campo `cwd` das linhas.
- Entra na busca o texto das mensagens do usuário e do assistente, mais uma linha
  `[ferramenta Nome]` por chamada de ferramenta. Resultados de ferramenta não entram, e cada
  mensagem é cortada em 8 KB.
- O formato é interno ao Claude Code. Tipos de linha desconhecidos ficam guardados crus e fora da
  busca; linhas que não são JSON são contadas como erro e puladas.
- A leitura é incremental (só o que foi acrescentado), por observação de arquivos e por varredura
  a cada 10 s. Um arquivo que encolheu é lido de novo do zero.
- A busca usa FTS5 do SQLite; sem ele, o daemon cai para `LIKE` e registra a decisão no boot.
- Uma sessão é marcada **possivelmente em uso** quando o arquivo mudou nos últimos 2 minutos.

As raízes ficam em `history.roots` na config, com padrão `["~/.claude/projects"]`:

```json
{
  "history": {
    "roots": ["~/.claude/projects"],
    "excludeCwds": ["~/clientes/sigiloso", "C:/Users/eu/privado"]
  }
}
```

## Excluir pastas

Sessões cujo `cwd` é uma pasta de `history.excludeCwds`, ou fica dentro dela, nunca entram no
índice. A comparação usa o `cwd` gravado nas linhas, nunca o nome do diretório em
`~/.claude/projects`. No Windows e no macOS ela ignora maiúsculas e o tipo de barra. Mudou a
lista? [Reconstrua o índice](#reconstruir-o-índice): sessões já indexadas só saem, e arquivos já
excluídos só voltam, depois disso.

## Reconstruir o índice

```sh
flightdeckd history reindex [--config <arquivo>]
```

Apaga o índice de histórico e lê todos os transcripts de novo, imprimindo quantas sessões e
mensagens entraram. Pare o daemon antes: com outro processo no mesmo `dataDir`, o comando sai com
código 3.

## No app

- **Histórico por host** (🕘 ao lado do nome do host): sessões indexadas com título, pasta, data
  da última mensagem, origem (`Flightdeck` ou `terminal`) e o selo "possivelmente em uso";
  filtros por pasta, período (dias inteiros, em UTC) e origem. Os botões **Lista/Cartões** (a mesma
  escolha da tela Sessões) desenham cada sessão como um cartão com título, pasta, host, data,
  origem, o selo "possivelmente em uso" e, nos hosts que informam custos, o custo estimado.
- **Busca global** (`Ctrl+K` dentro do app, ou "Buscar no histórico"): é a última seção da
  [paleta](daily-use.md#paleta-ctrlk). Enter, sem nada escolhido, consulta todos os hosts online em paralelo
  e junta os acertos por data, com host, pasta e trecho destacado. Host offline, ou que não
  responde em 5 s, aparece como "sem resposta" sem travar o resto.
- **Leitor:** somente leitura, com o visual do chat, carregando páginas conforme a rolagem. Vindo
  da busca, abre no ponto do acerto; fora isso, abre nas últimas mensagens, e "Carregar anteriores"
  traz as de antes sem mexer no que você está lendo. Uma linha de ferramenta (Bash, Read, Grep...) abre
  com um clique, Enter ou Espaço na entrada inteira (o comando, o arquivo, o padrão) e no resultado,
  lidos do transcript quando você abre; um erro fica em vermelho, um resultado acima de 64 KB é
  cortado e avisa, e uma chamada ainda sem resultado diz que está rodando ou foi interrompida.
- **Onde a conversa abre:** uma sessão (gerenciada, de terminal ou do histórico) abre na última
  mensagem e fica no fim enquanto imagens, código e painéis se ajeitam. Se você rolar para cima, ela
  fica onde você está e o botão **Ir para a última** conta as mensagens novas ("3 novas"). Ao voltar
  para uma aba, a conversa está onde você a deixou.
- **Continuar no Flightdeck** transforma o transcript numa sessão gerenciada com `resume`. Se a
  sessão estiver possivelmente em uso, o app pede confirmação antes, porque dois processos
  escrevendo na mesma conversa a corrompem. **Copiar comando** copia `claude --resume <id>` para
  usar no terminal.
- **Atalho global:** veja [Atalho global](daily-use.md#atalho-global).
