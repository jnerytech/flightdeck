# Revisão de mudanças

[Voltar ao manual](../pt-BR.md) · [English](../en/reviewing-changes.md)

Toda sessão (gerenciada ou do terminal) e todo card tem uma aba **Mudanças**, ao lado da conversa.
É onde você confere o que o agente fez e devolve a ele o que corrigir.

- **O que mostra:**
  - numa sessão cuja pasta está num repositório git, o working tree contra o `HEAD`, com os
    arquivos não rastreados;
  - num card, o diff contra a base, com quantos commits ele está à frente e atrás dela;
  - os arquivos com status e contagens, e o diff unificado ou lado a lado, com as linhas
    numeradas. Um arquivo binário aparece na lista, sem diff;
  - um arquivo grande demais (mais de 512 KB de diff ou de arquivo novo) aparece na lista com a
    marca **Grande demais** e o tamanho, sem conteúdo, para o painel não travar. O mesmo vale
    para o que passa de 4 MB de diff no total: os arquivos seguintes entram só na lista. Num host
    desta máquina, **Mostrar na pasta** abre o gerenciador de arquivos no arquivo (o editor
    segue ao lado, e recusa o que passa de 1 MB);
  - um arquivo que pode guardar uma credencial (`.env*`, `id_*`, `*.pem`, `*.key`, `.npmrc`, o que
    está em `.ssh` ou `.aws`, e o resto da lista que as regras de permissão usam) aparece com a
    marca **Oculto**, sem conteúdo nem contagens. O host nunca lê um arquivo novo desses, e o
    editor se recusa a abri-lo ou gravá-lo, mesmo por um link com outro nome. Um link que leva
    para fora do repositório também é recusado;
  - acompanha o disco ao vivo (o host observa a pasta, com debounce de 500 ms), e **Atualizar**
    lê de novo.
- **Aba Arquivos** (quando o host lista arquivos): o repositório da sessão como árvore. Pastas
  primeiro, depois arquivos, em ordem natural (`file2` antes de `file10`); uma pasta abre com um
  clique e é lida ao abrir, e de novo quando a sessão escreve ou remove um arquivo nela (não precisa
  reabrir a aba). Um arquivo alterado mostra o status (novo, modificado, apagado,
  renomeado) do mesmo diff da aba Mudanças, ao vivo, e cada pasta acima dele diz **tem mudanças**.
  Um arquivo que pode guardar uma credencial aparece como **Oculto**. O `.git` e links que levam
  para fora do repositório nunca aparecem. **Filtrar por nome** mantém os nomes que batem entre as
  pastas já abertas, com as pastas no caminho. Uma pasta com mais de 500 entradas mostra as
  primeiras e avisa. Uma sessão fora do git não tem árvore: a aba diz isso. Um clique num arquivo
  o abre abaixo da árvore, só para leitura, com as linhas numeradas e colorido por token nas
  linguagens comuns (TypeScript, JavaScript, JSON, Python, Rust, shell, TOML, YAML, CSS, Go, HTML,
  XML, diffs, Dockerfiles); um arquivo de mais de 1 MB, um
  que não é texto ou uma credencial diz isso no lugar. Um arquivo alterado tem **Mostrar mudanças**:
  o diff dele contra o HEAD, ao vivo. Enquanto você está no fim, a mudança mais nova entra na tela
  conforme a sessão edita; role para cima e isso para, e **Ir para a mais recente** (com quantas
  mudanças chegaram) ou uma rolagem de volta ao fim retoma. Num host deste computador o visualizador
  também tem **Abrir no app padrão** e **Mostrar na pasta**.
- **Comentários inline:**
  - clique no número de uma linha para comentá-la, e com shift em outra para estender o intervalo.
    Uma linha apagada é comentada pelo lado antigo. O número mostra a marca de Comentar quando
    você aponta ou chega nele com Tab. A caixa do comentário recebe o foco: **Ctrl+Enter**
    adiciona o comentário e **Esc** fecha a caixa;
  - os comentários ficam em rascunho, que dá para editar ou remover, até **Enviar revisão**;
  - a revisão vai para a sessão gerenciada, para a sessão do card ou para o canal de uma sessão do
    terminal aberta com `flightdeckd claude`. Uma sessão que não recebe mensagens ganha o texto
    copiado, e os comentários contam como enviados;
  - numa sessão aberta pelo Flightdeck, **Revisar na caixa de mensagem** põe a mesma revisão na caixa de mensagem da
    sessão, depois do que você já tinha digitado, e abre a conversa: edite e envie por lá. Os
    rascunhos continuam rascunhos (só **Enviar revisão** os marca como enviados), então use um
    ou outro;
  - um comentário segue o trecho citado quando o arquivo muda, e mostra **Desatualizado** quando o
    trecho some. Os enviados continuam na lista como histórico.
- **Segunda opinião** (num card, quando o host oferece): **Pedir uma segunda opinião** pede a uma
  segunda chamada do Claude que leia o diff do card e deixe os achados como rascunhos do revisor.
  Nada começa sozinho: você pede, o botão fica desligado enquanto uma execução roda ou quando não
  há mudanças, e o host recusa (e diz por quê) enquanto está em pausa, no limite de pausa da cota
  do plano, sem memória ou no orçamento do card, e depois de 3 revisões do card em um dia. O mesmo
  diff é revisado uma vez: pedir de novo mostra essa revisão. A chamada não tem ferramentas e vê só
  o texto do card e o diff, com os segredos mascarados; o diff vai para a Anthropic, como a sessão
  do próprio card já o envia. Cada achado que cai numa linha alterada vira um rascunho marcado
  **Revisor**, com a gravidade (Bloqueante, Alto, Médio ou Baixo): edite (aí ele passa a ser seu),
  **Dispensar**, ou deixe, e **Enviar revisão** o manda ao card junto com os seus comentários, como
  uma sugestão a conferir. Os rascunhos ficam depois do diff inteiro: **Ir para os rascunhos**, ao
  lado da linha que os conta, leva ao primeiro. Os achados fora de uma linha alterada ficam listados sob o botão, como
  texto. **Abrir PR** diz quantos achados do revisor continuam abertos quando um é bloqueante ou
  alto, e abre o PR do mesmo jeito.
- **Reverter e editar:**
  - **Reverter** pede confirmação, volta ao `HEAD` (ou à base do card; um arquivo novo é removido),
    guarda uma cópia em `<dataDir>/review-trash/` por 7 dias e oferece **Desfazer** por 30 s;
  - **Editar** abre um editor de texto simples (arquivos de texto até 1 MB). Só grava se o arquivo
    estiver como estava quando foi aberto; se mudou no disco, dá para recarregar o texto do disco
    ou sobrescrever com o seu;
  - os dois valem só nas pastas de `allowedRoots`; em qualquer outra, o host só lê.
- **Sessões que mexeram num arquivo:** cada arquivo lista as sessões que o escreveram, a partir dos
  transcripts (`Write`, `Edit`, `MultiEdit` e `NotebookEdit`; mudanças feitas pelo `Bash` não
  entram).
- **Card e a base:**
  - **Atualizar com a base** faz o rebase da branch do card. Com conflito, aborta, deixa a
    worktree como estava e lista os arquivos;
  - **Merge e arquivar**, para um card sem PR: `merge --no-ff` (o padrão) ou `squash`. Se a base
    está em checkout em alguma worktree (em geral o `main` do repositório principal), o merge é
    feito ali, e só se aquela worktree estiver limpa; senão, vai por uma worktree temporária. Um
    conflito recusa e não muda nada. Depois do merge, a worktree e a branch do card somem e o card
    vai para Concluído. O campo **Mensagem do commit** leva a mensagem do merge; vazio, fica a
    padrão, com o título do card. **Escrever com IA** escreve a mensagem a partir do diff do card,
    das regras do repositório e dos commits recentes (issue #162).
- **Comentários do PR:** num card com PR, os comentários de revisão são lidos do GitHub (`gh api`)
  ou do Azure DevOps (`az devops invoke`) a cada consulta do PR, e listados com arquivo, linha,
  autor e estado (resolvido ou não). No GitHub, quem não é dono, membro nem colaborador ganha o
  selo **Autor externo**: trate o texto como não confiável. O Azure DevOps não tem esse campo, e
  por isso nada é marcado ali. Os comentários abertos vêm selecionados; **Enviar ao agente** entrega
  os escolhidos à sessão do card. Nada é postado de volta no provedor.

O host anuncia `review` no `host.info`; um host mais antigo não tem a aba Mudanças.

## As visões da página de uma sessão

A página de uma sessão mostra uma **visão** por vez: Conversa, Mudanças, Arquivos, Tempo, Rastro e
Mensagens, mais **Terminal** (cada uma só onde o host a oferece). Elas formam uma **barra de abas**: a visão ativa é
preenchida e tem uma barra embaixo, e a barra rola para o lado num painel estreito.

- **Clique** numa visão, ou use as teclas: **Alt+1** a **Alt+7** escolhem a 1ª a 7ª visão da barra
  (também de dentro da caixa de mensagem; `Ctrl+1` a `Ctrl+9` continuam sendo as abas do app), e com
  o foco na barra as **setas**, **Home** e **End** passam de uma visão a outra, dando a volta.
- **Terminal** é um shell no host da sessão, aberto na pasta da própria sessão (a worktree, num
  card): quem decide a pasta é o host, o app só diz qual sessão. Ele abre na primeira vez que você
  mostra a visão e vive enquanto a aba da sessão existir, ou até você fechá-lo na visão (**Fechar
  terminal**); trocar de visão só o esconde, e uma aba que volta encontra o mesmo shell. Fechar a
  aba da sessão encerra o shell dela. Ele tem a busca, copiar e colar e os links do terminal. Uma
  sessão iniciada num terminal ("Claude aqui") mostra aquele terminal, e fechar a aba o deixa
  rodando. **Ctrl+\`** alterna entre o Terminal e a Conversa (o shell nunca a recebe). A visão
  precisa do terminal ligado no host; um host antigo não tem.
- A paleta (**Ctrl+K**) lista **Mostrar Mudanças**, **Mostrar Rastro** e as outras da página em que
  você está, primeiro entre os comandos, e a folha `?` lista as teclas em **Visões da sessão**.
- A conversa fica onde estava: o que você digitou na caixa continua lá depois de uma visita a outra
  visão.
- Cada aba de sessão **lembra a última visão** enquanto o app roda; uma aba que você nunca trocou
  abre na conversa.

## `.worktreeinclude`

Uma worktree nova recebe os arquivos rastreados do repositório, mas não os ignorados, como `.env`.
Para levá-los ao card, crie `.worktreeinclude` na raiz do repositório, com padrões no formato do
`.gitignore`:

```gitignore
.env
.env.local
config/*.secret.json
```

- **O que é copiado:** do repositório principal, os arquivos **ignorados pelo git** que casam com
  os padrões, até 50 MB no total. Acima disso, o card avisa quantos ficaram de fora.
- **O que nunca é copiado:** nada de `.git/` nem de `.flightdeck/`.
- **Padrão embutido:** `.claude/settings.local.json`, as regras do projeto da Fase 7, entra sempre.
- O formulário do projeto, no app, avisa quando o repositório não tem `.worktreeinclude`, com um
  exemplo.

## Statusline do Claude Code

`flightdeckd statusline` imprime uma linha como `5h 35% · 7d 27% · hoje $4.20 · sessão $0.84`: a
cota do plano, o custo estimado do dia e o custo da sessão. Ele lê o JSON que o Claude Code passa
no stdin e consulta o daemon local, com prazo de 300 ms. Com o daemon fora do ar ou lento, imprime
uma linha vazia e sai com 0.

O Flightdeck **nunca escreve** a configuração da statusline. Para usar o comando, ponha você mesmo
no `~/.claude/settings.json`:

```json
{ "statusLine": { "type": "command", "command": "flightdeckd statusline" } }
```

Para somar à statusline que você já tem, chame os dois num script e junte as linhas. O stdin vai
para os dois:

```bash
#!/usr/bin/env bash
input=$(cat)
mine=$(printf '%s' "$input" | ~/.claude/minha-statusline.sh)
fd=$(printf '%s' "$input" | flightdeckd statusline)
printf '%s%s\n' "$mine" "${fd:+ · $fd}"
```

O comando usa a config do daemon (`~/.flightdeck/config.json`, ou `--config <arquivo>`) e nunca a
cria.
