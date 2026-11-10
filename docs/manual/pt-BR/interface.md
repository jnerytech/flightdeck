# Interface

[Voltar ao manual](../pt-BR.md) · [English](../en/interface.md)

## Desenho e navegação

O app segue um desenho só, no estilo do Linear: Inter embutida (sem rede), base de 13 px,
superfícies em camadas, um único token de destaque e o estado das sessões como um glifo num espaço
de 12 px, com forma além da cor: rodando é um anel azul que gira (parado, com o topo aberto, quando
o sistema pede menos movimento, e parado enquanto está fora da tela), precisa de você é um ponto de
interrogação âmbar num balão, erro é um círculo de alerta vermelho, ociosa é um pontinho cinza e
encerrada é um anel esmaecido. Passe o mouse para ver o nome.

- **Barra lateral:** logo, navegação (Sessões, Precisa de você com o contador, Board, Workflows,
  Custos, Histórico), os hosts, as sessões fixadas e, no rodapé, a busca (`Ctrl K`),
  Configurações e o tema. Recolhe para um trilho de ícones de 56 px, sozinha abaixo de 1024 px, e abaixo de 640 px vira uma gaveta.
  Numa janela larga o botão a recolhe para o trilho e a abre de novo, e o app lembra a escolha na
  próxima vez que abrir larga.
- **Tamanho da janela:** a janela abre em 1200 x 800 e pode encolher até 360 x 480, estreita como um
  celular, para ficar ao lado de um editor. Estreita, a barra lateral vira uma gaveta e as abas viram
  um botão só.
- **Três colunas** em Sessões, Precisa de você e Histórico: a lista à esquerda (largura
  ajustável e guardada), a sessão, o pedido ou a transcrição à direita. Board, Custos,
  Configurações e as páginas do host usam a largura toda. O cabeçalho mostra o caminho
  (Sessões > sessão, Histórico > host, Board > projeto > card).
- **Teclado:** `J` e `K` movem pela lista, `Enter` abre, `Esc` fecha o detalhe, `A` e `N`
  aprovam e negam, `Ctrl K` abre a paleta, `Alt+←` e `Alt+→` voltam e avançam.
- **Densidade:** linhas compactas (32 px, o padrão) ou confortáveis (40 px), em Configurações.
- **Contador do cache do prompt** (Configurações, desligado por padrão): o Claude Code mantém o
  início da conversa em cache por 5 minutos (1 hora com cache estendido, **Duração do cache** nas
  Configurações), e responder dentro dessa janela custa menos. Com o contador ligado, uma sessão
  ociosa na lista de Sessões (linha e cartão) e na linha de estado sob a caixa de mensagem mostra
  um relógio pequeno com o tempo que resta em `m:ss`, na cor de aviso no último minuto e só o
  relógio quando o cache esfria (a próxima mensagem
  reenvia todo o contexto como tokens sem cache). Leitores de tela ouvem "Cache do prompt expira em
  2 minutos 10 segundos". A aba da sessão leva só o ícone do relógio no canto (o tempo fica na dica),
  então ela não fica mais larga. A contagem não roda para sessões em andamento ou encerradas, um único
  relógio de 1 segundo atende todas, e ele para enquanto a janela está escondida.
- **Tema:** Claro, Escuro e Sistema (o padrão), em Configurações, na barra lateral e na paleta.
  A escolha fica guardada.
- **Idioma:** o do sistema (`pt-BR` para qualquer `pt-*`, `en` para o resto), trocado em
  Configurações ou na paleta, sem reiniciar. Datas e horas saem sempre em hora local. O
  vocabulário está em [`docs/GLOSSARY.md`](../../GLOSSARY.md).
- **Modos de permissão** aparecem com nome e uma linha de explicação, nunca com o valor técnico;
  o "Ignorar permissões" avisa em vermelho e só aparece em um host que o permite.

## Modo demonstração, prints e testes de ponta a ponta

```bash
bun run demo         # sobe dois hosts de mentira (runtime fake, dados semeados) e a entrada web
                     # do app já pareada, em http://localhost:1420
bun run demo:shots   # os prints das telas, nos 2 temas e nos 2 idiomas, em
                     # apps/desktop/screenshots/ (e o axe-core, que reprova serious e critical)
bun run e2e          # as cinco jornadas num navegador de verdade, nos 2 idiomas, e a conferência
                     # do layout a 1280x800 e a 800x600 (runner: @playwright/test; E2E_ONLY=a,b
                     # escolhe jornadas; -- --repeat-each 5 repete; relatório em playwright-report/)
```

Nada sai da máquina e nenhum dado real é usado. Os scripts usam o Chrome instalado (ou o Edge)
pelo `playwright-core`; no CI, o job `screenshots` roda os três e publica os prints.

## Logs e diagnóstico

Se algo quebrar, envie o log. O app de desktop guarda o próprio arquivo de log na pasta de logs do
sistema (no Windows `%LOCALAPPDATA%\dev.flightdeck.app\logs`, no Linux
`~/.local/share/dev.flightdeck.app/logs`, no macOS `~/Library/Logs/dev.flightdeck.app`), girado aos
5 MB em 5 arquivos. Ele registra o que acontece com os hosts (conectou, ficou offline), o que um
host recusou, o resultado das verificações de atualização e os erros e avisos do console do próprio
app. **Configurações > Diagnóstico** tem **Abrir a pasta de logs** e **Copiar diagnóstico**: o segundo
copia a versão e o sistema do app, o nome, o estado, a versão e os recursos de cada host (nunca um
endereço ou token) e as últimas 50 linhas do log, para colar numa mensagem. Nenhum dos dois botões
existe no navegador.

Quando um host fica offline, o log diz por quê, para que uma queda que se repete possa ser lida (#939). O
app escreve uma linha para cada queda de um link que estava online (um aviso): o código e o motivo do
fechamento, se o host ou o app o fechou, há quanto tempo o link estava de pé, há quanto tempo nada vinha
do host e há quanto tempo veio o último ping do heartbeat. O daemon escreve uma linha para cada conexão
que fecha: o nome que o cliente deu, o código e o motivo, se foi o daemon (tempo do heartbeat, token
errado, token trocado) ou o cliente que fechou, e os mesmos relógios. Nenhuma das linhas tem token,
endereço ou mensagem.

O daemon também guarda um log, `flightdeckd.log` em `~/.flightdeck/logs` (também girado), e o
`host.info` diz onde fica. Na página de um host, **Copiar as últimas linhas de log do host** copia
até 100 delas.

Cada linha é editada antes de ser gravada, pelo mesmo verificador que protege snippets e personas:
um token (GitHub, Slack, AWS, chaves `sk-`, npm, GitLab, Stripe e Google, JWTs), um cabeçalho
`Authorization` ou `Cookie`, um nome que contém password, secret, token ou key seguido de `=` ou `:`
(também dentro de JSON, como `{"apiKey":"…"}` ou `DB_PASSWORD=…`), opções `--password`/`--token`,
`curl -u`, um bloco inteiro de chave privada, uma senha ou um token numa URL, uma URL de webhook,
um link assinado e o token de um link de pareamento viram `[redacted]`. Além dos padrões, o host
nunca grava os próprios tokens (o do protocolo, mesmo depois de um rodízio, e o dos hooks) nem
qualquer valor que o cofre guarda naquele momento, e o app nunca grava o token de um host nem um
valor do cofre com 6 caracteres ou mais. É uma lista de padrões, não uma garantia: um segredo
embrulhado em base64, partido em duas linhas de log, ou um valor curto do cofre (menos de 6
caracteres) não é pego. A sua pasta pessoal (`/home/<nome>`, `/Users/<nome>`, `C:\Users\<nome>`) é
gravada como `~`. A pasta de logs é só sua (0700, arquivos 0600) e um link plantado nela nunca é
seguido. Um host entrega o log (`logs.tail`) e o caminho dele só a conexões de loopback ou Tailscale,
como o cofre, e nunca mais que os últimos 256 KiB de cada arquivo. Leia as linhas antes de postá-las
em público.

## Desempenho

O que mantém o app e o daemon leves, e os números que você mesmo pode ler.

- **Listas longas.** O hub mostra as primeiras 200 sessões de um host; **Mostrar mais N**
  acrescenta o resto. Um host que reconecta, ou o resumo de outro host que muda, não redesenha as
  telas que não o mostram.
- **Texto ao vivo.** O daemon agrupa as palavras transmitidas de uma resposta em um quadro a cada
  25 ms, em vez de um quadro por palavra, para que um celular em um link lento acompanhe. A
  ordem e o conteúdo são os mesmos; um cliente atrasado é ressincronizado, não deixado para
  trás.
- **Terminal.** O daemon para de ler a saída de um terminal enquanto o app está muito atrasado
  (um `yes` ou um `cat` de um arquivo grande) e volta quando o app alcança. Um terminal cujo app
  nunca alcança é ressincronizado a partir da saída guardada. As teclas digitadas continuam
  respondendo.
- **Sob demanda.** O editor, o renderizador de Markdown e a biblioteca age carregam quando você
  abre pela primeira vez algo que precisa deles, e o app inicia mais rápido. Um daemon sem nada a
  fazer não mantém timers para recursos desligados (automações, orçamentos, vigia de PR).
- **Medidas de depuração.** Para medir as cinco ações mais usadas (abrir uma sessão, um quadro,
  um card; enviar; aprovar), rode `localStorage.setItem("flightdeck.debug.measures", "1")` no
  console de uma build de depuração e recarregue. As entradas `fd:open-session`,
  `fd:open-board`, `fd:open-card`, `fd:send` e `fd:approve` aparecem no painel Performance do
  navegador (ou em `performance.getEntriesByType("measure")`). Nada vai para o log nem para o
  console, e com a flag desligada nada é medido. `send` e `approve` terminam quando o daemon
  respondeu.
- **Números para quem desenvolve.** `bun run perf:baseline` imprime a linha de base,
  `bun run bundle:budget` o tamanho de cada pedaço (a build falha acima do orçamento) e
  `bun run smoke:perf` roda o daemon contra uma enxurrada de saída.
