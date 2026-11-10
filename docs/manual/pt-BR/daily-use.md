# Uso diário

[Voltar ao manual](../pt-BR.md) · [English](../en/daily-use.md)

## Precisa de você, página do host e notificações

- **Precisa de você:** na barra lateral, com o contador de pedidos abertos em todos os hosts. A
  tela lista os pedidos, do mais antigo ao mais novo, e o cartão do pedido escolhido fica ao
  lado: **A** aprova, **N** nega e **Esc** fecha o detalhe. **Abrir sessão** leva à conversa. O
  cartão recebe o foco, então A e N funcionam sem um clique antes, e quando um pedido é
  respondido o próximo é escolhido, com quantos restam. Um pedido de risco alto continua sendo
  aprovado só segurando o botão.
- **Concluídas:** sob os pedidos, o grupo **Concluídas** lista as sessões que terminaram um turno,
  falharam ou encerraram desde a última vez que você olhou o Precisa de você, da mais nova para a
  mais antiga, cada uma com como terminou, há quanto tempo e (quando o host responde) quantos
  arquivos alterou. Escolha uma e **Ver as alterações** abre a sessão na visão Alterações. Sair da
  tela é o olhar: o grupo fica vazio da próxima vez. Uma sessão que você estava vendo quando
  terminou não entra, e o grupo não soma no contador da barra lateral, que conta pedidos. A
  notificação do sistema de um turno concluído ou de uma falha é a que você já tinha: sai uma vez,
  nunca com o app em foco.
- **Sessões em silêncio:** uma sessão que consta como rodando mas não produziu nada em 15 minutos
  (30 enquanto uma chamada de ferramenta está aberta, pois um build pode ficar em silêncio) aparece
  sob os pedidos como "Em silêncio há 23 min · última: Bash", num daemon que anuncia `stall`.
  Escolha-a para **Abrir**, **Parar o turno**, **Enviar "continue"** e **Não travou, adiar 1 h** (que
  tira essa sessão da lista e do cartão dela por uma hora, diz quando ela volta e vale também depois
  de reiniciar o app, neste computador). Ela sai da lista no próximo sinal de
  vida, e uma sessão esperando uma aprovação nunca fica em silêncio. Sai uma notificação do sistema
  quando ela fica em silêncio, nunca com o app em foco; o cartão Trabalhando do quadro de Atividade
  e o cartão do quadro do projeto trazem a marca "Em silêncio 23 min". `stall.afterMinutes` na configuração do daemon define os 15
  (0 desliga).
- **De uma notificação:** o clique abre a sessão com o cartão do pedido em foco: uma tecla
  responde. No sino, a entrada de um pedido já respondido abre a sessão naquele pedido.
- **Dependências:** a aba Visão geral da página do host tem uma seção **Saúde e dependências** (abaixo) que agrupa o
  que o host precisa em **Obrigatórias** (Claude Code, git com worktrees, o serviço que sobe o
  daemon no boot, ao menos uma pasta permitida) e **Opcionais** (as ferramentas do GitHub, do Azure,
  o SSH e o Tailscale, o PowerShell no Windows, os hooks do Claude Code). Cada linha tem um ícone e
  uma palavra (check verde OK, alerta âmbar para uma opcional faltando ou desatualizada, cruz
  vermelha para uma obrigatória faltando, traço cinza quando não se aplica ao sistema do host), a
  versão encontrada e a mínima, o que deixa de funcionar sem ela, e o comando para instalá-la no
  sistema daquele host com um botão de **copiar**. **Verificar de novo** pergunta ao host outra vez.
  O resumo diz "Tudo certo", "Opcionais faltando: N" ou "Obrigatórias faltando: N", e um host com
  uma obrigatória faltando ganha uma marca vermelha na barra lateral. O `flightdeckd doctor` imprime o mesmo agrupamento no terminal, depois das suas próprias
  verificações, com a correção para o sistema do host sob cada uma que falta ou está desatualizada.
- **Layout da página do host:** a página abre nas **Sessões** daquele host (as que precisam de você
  primeiro, depois as mais recentes; **Ver todas as sessões** abre a lista de Sessões já filtrada
  pelo host, só nessa visita: o filtro que você salvou para a próxima vez não muda) e nos **Projetos** dele (os mesmos cartões da lista de Projetos; **Ver todos os
  projetos** abre essa lista filtrada pelo host, com um chip que limpa o filtro). Um host sem
  nada diz isso e oferece **Nova sessão**. O resto fica em três abas: **Visão geral** (sessões,
  projetos, a conta do Claude e as informações do host), **Consumo** (cota e a tabela de consumo)
  e **Configurações** (pastas permitidas, hooks, limpeza de worktrees, telemetria, terminal, manutenção, reconectar e
  remover). As abas respondem às setas do teclado.
- **Página do host:** clique no nome do host para ver sistema, versões, sessões ativas, latência
  do heartbeat, renomear, reconectar e remover. Um host que repassa a chave de API ao Claude
  ganha um selo ⚠. O tempo no ar continua contando enquanto a página está aberta.
- **Recursos:** um painel da página do host (hosts que anunciam `resources`) mostra a memória e o
  disco do host em barras, a carga, e uma tabela das sessões e terminais com a maior memória
  primeiro: projeto, memória, CPU e os programas rodando (só os nomes; nunca uma linha de comando
  nem o ambiente). Memória ou disco a 80% diz **Alta** e a 90% **Crítica**, em palavras e em cor.
  **Processos que sobraram** lista um `claude` que o daemon do host iniciou para uma sessão que
  já acabou (com mais de um minuto, na pasta dessa sessão, iniciado enquanto ela vivia), com pid,
  idade e memória; um `claude` que o daemon inicia para outra coisa (instalação de plugin, consulta
  da conta, uma ação) ou o processo de uma sessão viva cuja pasta foi movida nunca é listado; **Encerrar** pergunta antes e encerra só
  esse processo (o daemon confere de novo, logo antes do sinal, que é o mesmo processo, por pid e
  hora de início, ainda filho dele e sem dono). Um `claude` cuja pasta não pode ser lida, ou que roda
  numa pasta onde há uma sessão viva, nunca é listado: não dá para saber de quem é cada um. Um daemon
  rodando como pid 1 (um contêiner) não lista nenhum. Encerrar exige conexão por loopback ou
  Tailscale, como os outros comandos que mudam o host, e manda SIGTERM só àquele processo. O painel lê a cada
  5 s enquanto a página está aberta e o host está online, e o daemon não mantém timer para isso. Os
  números por processo vêm de `/proc`, então só hosts Linux os têm; hosts macOS e Windows mostram a
  memória e o disco (e a carga, no macOS) e dizem que os processos não são medidos. Uma sessão é
  ligada ao seu `claude` pela pasta e pela ordem de início, então duas sessões na mesma pasta podem
  trocar os números.
- **Worktrees:** um painel da página do host (hosts que anunciam `worktrees`) lista as worktrees
  dos cards em `.flightdeck/worktrees` com o tamanho em disco (**desconhecido** quando a medição
  estourou o tempo, nunca 0), há quanto tempo estão paradas e o card de cada uma. **Sugerida** marca
  uma worktree limpa, sem commits não enviados e sem sessão ao vivo, parada há mais de 7 dias, cujo
  card está Concluído ou cujo PR foi mesclado, ou que não tem card. Uma worktree com alterações não
  commitadas, commits que não existem em outro lugar, sessão, terminal ou execução rodando, branch base
  desconhecido (precisa ser um branch de verdade, não uma tag nem `HEAD`), um branch que não é um
  `fd/…` do Flightdeck, arquivos ignorados que um build não recria (só `node_modules`, `dist`,
  `build`, `target`, `coverage`, `.cache`, `.next` e `out`, como pasta na raiz da worktree, não
  contam, e um arquivo de credencial ignorado, como `.env` ou `*.pem`, sempre conta), alterações que
  o git esconde do `git status` (`assume-unchanged` ou `skip-worktree`), ou algo que o git não soube
  responder fica **mantida**: a linha diz por quê e não pode ser marcada. A confirmação diz que as
  pastas recriáveis saem junto com a worktree. Filtre por Sugeridas,
  Protegidas ou Sem card, ordene por idade ou tamanho, **Selecionar sugeridas** ou **Selecionar
  todas que podem sair**, e então **Remover**: a confirmação cita cada branch com o card e a coluna, e o espaço
  liberado. Só as linhas na tela podem ser marcadas ou removidas. O host trava cada pasta (nada
  pode começar nela) e confere de novo antes de removê-la (sem force), então uma que mudou nesse
  meio-tempo é mantida; o branch só é apagado se ainda estiver no commit que foi conferido, senão
  a pasta sai e o branch fica, e o resultado diz isso. O card, se houver, continua no board sem a worktree. Um disco com menos de
  10% livre gera aviso. Apagar algo que está mantido continua sendo pelo **Descartar** do card.
- **Um host desconectado** mostra um aviso no topo da página dele: o estado, o que falhou em
  palavras simples (nada respondeu, sem resposta a tempo, a conexão caiu, o token foi recusado), a
  hora da última tentativa, a contagem até a próxima tentativa automática e **Reconectar agora**,
  que mostra o andamento e depois "Continua desconectado." se falhou. As seções que dependem da
  conexão dizem "Host desconectado" em vez de "consultando…". Para uma conexão recusada em um host
  local, WSL ou Linux, o aviso lista os comandos para conferir o daemon
  (`systemctl --user status flightdeckd`, `sudo loginctl enable-linger $USER` e `systemd=true` em
  `/etc/wsl.conf` no WSL). O app também tenta um host desconectado na hora, e reinicia a contagem,
  quando a janela volta a ter o foco ou a rede volta (no máximo uma vez a cada 2 segundos). Quando o daemon roda mas recusa o endereço desta máquina
  (ele está fora de `allowedNetworks`), o `flightdeckd doctor` diz isso e cita o endereço; o app não
  consegue separar isso de um daemon parado, então, para um host que não está nesta máquina, ele
  acrescenta a dica de conferir `allowedNetworks` (o `flightdeckd setup` inclui as redes do
  Tailscale).
- **Notificações** trazem o nome do host.
- **Fechar a janela** manda o app para a bandeja (desligável em Configurações). **Iniciar com o
  Windows** fica em Configurações, desligado por padrão.
- **Instância única:** abrir o app de novo (ou um link `flightdeck://`) foca a janela existente.

## Bandeja

O ícone da bandeja tem Abrir, o submenu **Precisa de você (N)** e Sair. O submenu lista até 10
pedidos abertos, de sessões gerenciadas e do terminal, do mais antigo ao mais novo, no formato
`host · sessão · ferramenta: resumo da entrada` (por exemplo `pc · api · Bash: npm test`).

- Cada pedido abre um submenu com **Aprovar**, **Negar** e **Abrir**. Aprovar e Negar respondem no
  host do pedido, sem abrir a janela; Abrir traz o app na sessão, com o card de aprovação.
- Gates de workflow aparecem só com **Abrir**: eles pedem leitura, e a resposta fica no card. Um
  pedido de risco alto e um pedido de segredo têm **Negar** e **Abrir**: aprovar pede a janela.
- Acima de 10, a última linha é **e mais N…**, que abre o app.
- O submenu é refeito meio segundo depois de a lista parar de mudar.
- **Notificação de pedido:** leva o link `flightdeck://request?host=…&request=…`, que abre o app
  focado no pedido. No app desktop, o plugin de notificação do Tauri não informa cliques no
  Windows nem no Linux: lá, a bandeja é o caminho rápido. Abrir o link por fora (por exemplo,
  `start flightdeck://request?...`) funciona.

## Abrir no terminal

O botão **Abrir no terminal** aparece na sessão (gerenciada e do terminal), no card (a worktree
dele) e em cada projeto da tela Projetos. A sessão é retomada com
`flightdeckd claude --resume <id>`, e o projeto abre um `claude` novo na pasta.

| Host | O que roda |
| --- | --- |
| Este Windows (daemon em `127.0.0.1`) | `wt.exe -d <pasta> <flightdeckd> claude --resume <id>`; sem o Windows Terminal, `cmd.exe /c start "" /d <pasta> cmd /k <flightdeckd> claude …` |
| WSL supervisionado (daemon Linux em `127.0.0.1` dentro de uma distro) | `wt.exe wsl.exe -d <distro> --cd <pasta> -- <flightdeckd> claude …` (sem o Windows Terminal, pelo `cmd /c start`) |
| Qualquer outro | o botão vira **Copiar comando**: `cd <pasta> && <flightdeckd> claude --resume <id>` |

- `<flightdeckd>` é o binário estável (`~/.flightdeck/bin/flightdeckd`, da
  [atualização](host-operations.md#atualizar-com-flightdeckd-update)) quando ele existe no host, senão
  `flightdeckd` do PATH. O daemon informa os dois, e a distro do WSL, no `host.info`.
- O comando sai da casca Rust do app, com os argumentos em lista, sem passar por shell, a não ser
  o `cmd /k` do fallback. Ela só aceita `wt.exe` e `cmd.exe`.

## Paleta Ctrl+K

`Ctrl+K` (ou "Buscar no histórico", na barra lateral) abre uma paleta com seções nesta ordem:
**Sessões ao vivo**, **Cards**, **Projetos**, **Hosts**, **Ações** (Nova sessão em…, Ir para
Configurações) e, depois de Enter, **Histórico**.

- O que é local aparece na hora e filtra enquanto você digita. Enter sem nada escolhido busca no
  histórico de todos os hosts, que chega depois, sem apagar o resto.
- **↑/↓** escolhem, **Enter** abre e **Tab** mostra as ações da entrada (por exemplo, num projeto:
  Abrir board, Workflows, Abrir no terminal). Esc volta das ações para a lista e, dali, fecha.
- **Ir para Custos** aparece quando o app tem a tela de Custos e algum host anuncia `costs`.
- A linha em que o teclado está é uma superfície com um aro em volta, nos dois temas. A linha de
  uma sessão mostra o glifo do estado (rodando, precisa de você, ociosa) e acompanha as mudanças; a
  de um card tem o ícone do card.
- Sem nada digitado, uma seção **Recentes** vem primeiro, com até seis das entradas que você abriu
  (guardadas entre execuções): o que espera por você primeiro, depois o que está rodando, depois o
  resto. Cada uma mostra **Alt+1** a **Alt+6**, que a abrem com a paleta aberta (fora dela, as
  mesmas teclas escolhem as visões da página de uma sessão). A ordem fica fixa quando a paleta abre, para as linhas não se mexerem sob o cursor.
- A paleta abre **restrita ao lugar onde você está**: num board ou card, ao host e ao projeto dele;
  numa sessão ou na página de um host, ao host. Os filtros aparecem como chips sob o campo; clique
  num para tirá-lo, ou em **Limpar todos os filtros**. A mudança dura só até a paleta fechar.
- Texto que não casa com nenhum card termina a lista com **Criar card “texto” em projeto** (o
  projeto do filtro, ou o único projeto que existe). Colar um link de issue do GitHub ou digitar
  `#123` num projeto com provedor de issues oferece **Criar card da issue**, que liga a issue.
- Cada seção mostra oito linhas e depois um botão como **mais 22**; cada clique mostra mais vinte.
- **Ações** também tem **Ir para Sessões / Precisa de você /
  Projetos**, **Mostrar os atalhos de teclado** e, enquanto um pedido espera por você, **Aprovar o
  pedido mais antigo** e **Negar o pedido mais antigo** (um pedido de risco alto é aberto para ser
  segurado, como na bandeja). Cada comando mostra suas teclas à direita.

## Atalhos de teclado

`?` (fora dos campos de texto) abre uma folha com todos os atalhos, por grupo. Os atalhos de ir
para pressionam `g` e depois uma letra em até um segundo e meio: `g s` Sessões, `g n` Precisa de
você, `g p` Projetos, `g c` Custos, `g a` Atividade, `g ,` Configurações. Outros atalhos: `Ctrl+K` paleta,
`Alt+←`/`Alt+→` voltar e avançar, `Alt+Shift+C` próximo cliente, `Ctrl+T`/`W`/`Tab`/`1…9` abas,
`j`/`k`/`Enter` nas listas e `A`/`N` em um pedido. Nenhum dispara enquanto você digita em um campo.

O primeiro `Tab` em qualquer tela mostra **Pular para o conteúdo** no canto superior esquerdo; `Enter`
leva o foco além da barra de título e da barra lateral, para a própria tela (#1430).

## Atalho global

`Ctrl+Alt+F` traz o app para frente com a busca global aberta, mesmo com ele em segundo plano ou
na bandeja. Para mudar, abra **Configurações → Atalho global**, digite a combinação e clique em
**Salvar atalho**.

- Formato `Modificadores+Tecla`, por exemplo `Ctrl+Shift+Y`. A tecla é uma letra, um dígito ou
  `F1` a `F24`, e é preciso ao menos `Ctrl`, `Alt` ou `Super`.
- `Ctrl+K` é recusado: ele abre a busca dentro do app e, como atalho global, colidiria com o
  navegador e o VS Code.
- Se outro programa já usa a combinação, o app avisa e abre as Configurações para você escolher
  outra. O atalho só é salvo depois que o sistema o aceita.
