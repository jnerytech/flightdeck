# Decisões e divergências da Fase 10 (interface) (phase 10)

## Base

- **Componentes do shadcn fora da cobertura:** `src/components/ui/` é código gerado pelo CLI (Radix por baixo) e fica fora da cobertura e do lint. Em troca, `components.lock.json` guarda o hash de cada arquivo (`bun run ui:lock`) e um teste reprova o que for editado à mão: um componente mexido volta para a cobertura.
- **Um token de destaque:** o `--brand` alimenta o `--primary`, o `--ring` e o `--sidebar-primary`. O `accent` do shadcn continua sendo a superfície neutra do hover. Os estados (azul, âmbar, cinza, esmaecido, vermelho) são tokens à parte, com contraste AA nos dois temas, calculado no teste.
- **Inter pelo `@fontsource-variable/inter`:** os sete subconjuntos em woff2 vão no bundle do Vite, sem rede e dentro da CSP.
- **CSP e tema do Tauri:** `style-src 'unsafe-inline'` (o Radix e o sonner escrevem estilos em linha) e a permissão `core:window:allow-set-theme`, para a barra de título acompanhar o tema. A conferência no app instalado fica para o fechamento.
- **Sem estilo antigo:** o `styles.css` virou só tokens. Um teste reprova qualquer classe do estilo antigo em qualquer tela e qualquer `<button>` cru, sem estilo.

## Navegação e telas

- **Rota tipada** com pilha (`Router`): `needs-you` é uma rota nova, o leitor ganhou `list: "history"` (abre ao lado da lista do host) e `projects` ganhou `focus` ("Board" e "Workflows" da barra lateral).
- **Board e Workflows na barra lateral:** o host atual (o selecionado ou o primeiro online) tem o projeto único aberto direto; com vários, uma escolha mostra só o que a entrada pediu.
- **Três colunas por rota:** a lista de Sessões fica na tela enquanto a rota é sessão, terminal, leitor ou nova sessão; `Esc` volta para `hub`. O painel de cota foi para o detalhe vazio, que a lista de 380 px não comportava.
- **Largura da lista e densidade** ficam no storage da plataforma (`flightdeck.listWidth`, `flightdeck.density`), como o tema e o idioma: são conveniência de quem usa.
- **Filtros do hub:** só o campo "Filtrar" e um botão "Filtros" com o número de filtros ativos; host, origem, estado, fixadas e arquivadas ficam no popover. O texto digitado nunca é guardado (um texto velho esconderia linhas).
- **"Precisa de você" acima dos fixados** na ordem da lista, e o contador soma pedidos e alertas de orçamento.
- **Hosts:** online azul, reconectando âmbar pulsando, offline cinza vazado, recusado e incompatível vermelhos. A faixa do hub é uma linha ("N hosts com problema") que abre.
- **Cabeçalho com o caminho:** os passos de cima voltam; "Hosts" e "Histórico" encabeçam o caminho, mas não são telas. O último passo leva `aria-current="page"`.
- **Regiões que rolam pegam foco** (a conversa e as colunas do board), porque o axe reprova rolagem sem acesso pelo teclado.
- **Vazio com ação:** os rótulos "Novo card" e "Adicionar projeto" dos estados vazios são diferentes dos botões da tela, para o nome acessível não se repetir.
- **`alertdialog`:** as confirmações usam o papel `alertdialog` (foco preso, `Esc` cancela, verbo certo no botão destrutivo).
- **Toasts:** os ids levam o prefixo de cada instância do `Notices`, porque o sonner guarda o estado no módulo e duas lojas se pisavam.

## Textos

- **`useT()`:** componentes que não recebem `store` nem `t` (diff, chamada de ferramenta, formulários) leem o tradutor de um contexto; fora do app caem no português. O App troca o valor com o idioma.
- **Varredura de literais:** o detector lê o texto JSX em várias linhas e as propriedades `aria-label`, `title`, `placeholder`, `alt`, `subtitle`, `message`, `confirmLabel` e `label`; ignora comparações que parecem texto e templates sem espaço nem acento (ids). As exceções são `Flightdeck`, `Ctrl K` e o esquema `flightdeck://…`. Hoje ela cobre todas as telas e componentes.
- **Rótulos do `lib/`:** `budgetLine`, `budgetLabel`, `budgetAlerts`, `budgetLines`, `stepUsage`, `sessionLineText` e `projectionText` recebem o `t` (o padrão é o português, para os testes de unidade). Os mapas `STATUS_LABELS`, `RUN_LABELS` e semelhantes continuam exportados, mas a tela lê o dicionário.
- **Termos internos:** a linha do turno diz "turno concluído" ou "turno com erro" em vez do `subtype` do SDK, e o campo de caminho do projeto não cita mais `allowedRoots`. Uma lista proibida é testada em seis telas, no texto e nos atributos.
- **Modos de permissão:** seis nomes com uma linha cada; o valor técnico fica só no `value` do `<select>`. `bypassPermissions` ("Sem perguntas") mostra um aviso em vermelho com `role="alert"`.
- **Hora local em todo lugar:** o histórico, os acertos da busca, as execuções do card e a manutenção do host usam `store.formatDateTime`, no idioma do app. O `when()` em UTC saiu.

## Prints, axe e e2e

- **`bun run demo:shots`** leva o `axe-core` (4.10.2, fixado) a cada tela dos dois temas e dos dois idiomas e falha em `serious` ou `critical`, depois de gravar os prints. Os primeiros achados foram duas regiões que rolam sem foco.
- **`bun run e2e`** roda as cinco jornadas em cada idioma, com o `locale` do navegador igual ao idioma (o app começa pelo idioma do sistema). O demo guarda estado de uma jornada para a outra, então a aprovação pega o primeiro pedido da fila, qualquer que seja a ferramenta, e o card criado leva um título único.
- **Layout:** a 1280×800 e a 800×600, nada sai da janela para o lado fora de uma caixa que rola, e o último item da lista aparece depois de rolar só as caixas que uma pessoa rola.
- **CI:** o job `screenshots` (ubuntu) usa o Chrome do runner, roda os prints com o axe e o e2e, e publica `apps/desktop/screenshots` como artefato.

## Testes frágeis

- O teste do "Copiar comando" do `continuar` esperava o toast de falha no mesmo instante; agora espera o toast montar. O da bandeja (`bandeja-aprovacao`, debounce de 500 ms) falhou uma vez numa suíte carregada e passou na repetição; ele segue sensível ao tempo.
- O teste do `update` (`peças reais…`, Fase 9) continua com o dono dele e não foi tocado.
