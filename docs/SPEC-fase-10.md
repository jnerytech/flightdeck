# Flightdeck — Spec da Fase 10 (Interface)

## Objetivo e escopo

As funcionalidades andaram mais rápido que a interface. Uma revisão do código do app (29/10/2026) achou:

- telas inteiras sem estilo: 33 classes usadas no TSX sem nenhuma regra de CSS (`hub`, `needs-you`, `card-detail`, `host-page` e outras);
- a área principal com `overflow: hidden`, cortando listas longas;
- aprovação sem mostrar o comando, e JSON cru no cartão;
- navegação por cerca de 12 estados soltos, sem "voltar", e com um beco sem saída (Configurações aberta bloqueia o clique num pedido);
- ações sem retorno, estados vazios e de carregamento ambíguos, e termos internos (`bypassPermissions`, `allowedRoots`, `subtype`) na tela;
- a entrada do app (`main.tsx`) sempre usa a ponte do Tauri, então a interface não abre num navegador, nem para demonstração nem para prints.

A Fase 10 refaz a base da interface:

- **shadcn/ui** sobre **Tailwind CSS v4**, com **grid e componentes de layout padronizados**;
- **tema claro, escuro e do sistema**;
- **inglês e português (Brasil)**;
- aprovação legível, navegação com voltar, estados e avisos;
- um **modo demonstração**, com prints de todas as telas principais na CI.

Pré-requisito: Fase 8 fechada. As áreas de interface das Fases 11 e 12 usam esta base e só começam depois dela.

**Fora da Fase 10**

- Telas novas além das que existem. Esta fase refaz e padroniza as atuais.
- Outros idiomas além de `pt-BR` e `en`. A estrutura aceita mais idiomas.
- Comparação automática de prints, que é frágil. Nesta fase, os prints são gerados e publicados para revisão humana.

## Base técnica

- **Tailwind CSS v4** pelo `@tailwindcss/vite`. O `styles.css` atual é substituído pelos tokens do tema e pelo `@import "tailwindcss"`. Não sobra CSS solto por tela.
- **shadcn/ui:**
  - componentes copiados para `apps/desktop/src/components/ui/` pelo CLI do shadcn, com versões fixas no `package.json`;
  - primitivas Radix, `class-variance-authority`, `clsx` e `tailwind-merge`, com o utilitário `cn()`;
  - ícones do `lucide-react`, no lugar dos emojis 🕘 ▦ 📌 🗄 ⧉, sempre com `aria-label` e tooltip;
  - avisos com o `sonner`, que é o toast do shadcn;
  - paleta com o `cmdk`, que é o `Command` do shadcn. A paleta Ctrl+K da Fase 8 migra para ele.
- **Fontes:** a pilha do sistema (Segoe UI no Windows). Não há fonte externa, por causa da CSP do Tauri.
- **Cobertura:** `src/components/ui/` é código de fornecedor gerado pelo shadcn e fica fora da conta de 100%, o que vai registrado em `docs/DECISIONS.md`. Todo uso desses componentes é testado pelas telas, e um componente alterado à mão volta para a conta.

## Layout e grid

Todo layout sai de poucos componentes próprios, em `src/components/layout/`, sem margens ou larguras soltas nas telas.

| Componente | Papel |
| --- | --- |
| `AppShell` | grid de duas colunas (barra lateral recolhível de 260 px e conteúdo), com cabeçalho fixo; a barra recolhe sozinha abaixo de 960 px |
| `Page` | título, subtítulo, ações à direita, barra de ferramentas opcional e corpo **com rolagem própria** (`ScrollArea`); toda tela é um `Page` |
| `Section` | bloco com título e ações dentro de uma página |
| `Stack` / `Inline` | pilha vertical ou horizontal com `gap` da escala |
| `Grid` | grid responsivo por colunas (`cols={{ base: 1, md: 2, xl: 3 }}`), por exemplo para cards de host, painéis de cota e de custo |
| `Toolbar` | filtros e busca, com quebra de linha em janelas estreitas |
| `EmptyState` / `LoadingState` / `ErrorState` | os três estados padrão de uma lista ou de um painel |

**Escalas únicas:**
- espaçamento: 4, 8, 12, 16, 24 e 32 px;
- raio: 6 e 10 px;
- tipografia: 12, 13, 14, 16, 20 e 24 px, com 14 de base;
- larguras de conteúdo: leitura em 72ch e listas sem limite.

Um teste de lint de estilo reprova `style={{…}}` com medidas fixas nas telas e classes de cor fora dos tokens.

## Tema

- **Modos:** Claro, Escuro e Sistema, que é o padrão, em Configurações e na paleta ("Alternar tema"). A escolha fica guardada no app.
- **Tokens do shadcn:** variáveis CSS para `background`, `foreground`, `muted`, `primary`, `destructive`, `border`, `ring` e companhia, nos dois temas. A classe `dark` vai no `html`.
- **Cores de estado:** rodando, precisa de você, ociosa, encerrada e erro, mais o risco da Fase 13. Vivem nos tokens, nunca em hexadecimal solto, com contraste AA nos dois temas.
- **Janela do Tauri:** segue o tema (`setTheme`), para a barra de título não destoar.

## Idiomas (pt-BR e en)

- **Dicionários tipados:** `src/i18n/pt-BR.ts` e `src/i18n/en.ts`, com o mesmo tipo de chaves. Chave faltando ou sobrando num deles reprova o typecheck. A função é `t("hub.title")`, com interpolação (`t("hub.count", { n })`) e plural pelo `Intl.PluralRules`.
- **Idioma inicial:** o do sistema (`navigator.language`), com `pt-BR` para qualquer `pt-*`, e `en` como padrão para o resto. Troca em Configurações e na paleta, sem reiniciar.
- **Datas, horas, números e moedas:** `Intl` no idioma escolhido, **sempre em hora local**. Durações legíveis, como "há 3 min" e "2 h 5 min", no lugar de "no ar há N s".
- **Erros do daemon:** o daemon continua mandando `code` e uma mensagem. O app traduz pelo `code` com um mapa por idioma, e usa a mensagem do daemon só quando o código é desconhecido.
- **Fora da janela:** os rótulos da bandeja (Fase 8) e das notificações saem do mesmo dicionário. O frontend manda à casca Rust o texto já traduzido.
- **Um único glossário em `docs/GLOSSARY.md`,** aplicado nos dois idiomas:
  - Aprovar e Negar, também nos gates;
  - "Precisa de você", também para o estado;
  - sessão do terminal;
  - card.
- **Modos de permissão com nome legível e uma linha de explicação:**
  - Padrão, que pergunta antes de agir;
  - Aceitar edições;
  - Planejar, que só lê;
  - Sem perguntas, com um aviso vermelho.

  O valor técnico não aparece na tela.

## Navegação

- **Rota única tipada** (`Route`), por exemplo `{ name: "hub" }`, `{ name: "session", host, id }` ou `{ name: "card", host, cardId }`, com pilha de histórico.
  - Para voltar e avançar: Alt+← e Alt+→, os botões do mouse e um "voltar" no cabeçalho.
  - Substitui os 12 `useState` de `App.tsx`.
- **Deep links e atalhos:** os `flightdeck://` e os atalhos viram rotas.
- **Abrir um item fecha as camadas por cima:** abrir um pedido, sessão ou card fecha Configurações, diálogos e a paleta. Isso acaba com o beco sem saída atual.
- **Início rápido:** "Iniciar card" fica no menu do card na lista do board e na paleta, além do detalhe.

## Aprovação legível

- **Um componente só, `ApprovalCard`,** para sessões gerenciadas, do terminal e de card. Hoje são dois.
- **Mostra conforme a ferramenta:**
  - `Bash`: o comando num bloco de código, a descrição e o `cwd`;
  - `Write` e `Edit`: o caminho relativo e a prévia do conteúdo ou do diff;
  - outras: pares chave e valor, nunca JSON cru.
- **Botões:** ficam juntos, com a idade do pedido e as opções de "permitir sempre" da Fase 7. O motivo da negação abre só depois de clicar em Negar.
- **Atalhos com o cartão em foco:** `A` aprova, `N` nega (e abre o motivo) e `Esc` tira o foco.
- **Fila "Precisa de você", na barra lateral:** cada pedido mostra:
  - host e sessão;
  - ferramenta e o resumo do conteúdo (o comando ou o caminho, cortado);
  - idade.

  Clicar expande o cartão ali mesmo. A aprovação às cegas acaba.

## Estados, avisos e segurança

- **Carregamento:** `Skeleton`, com um tempo mínimo de 150 ms, para não piscar.
- **Vazio:** `EmptyState` com uma frase e uma ação, por exemplo "Nenhum card — Criar card".
- **Hosts:** offline e reconectando têm cores e textos diferentes. O hub mostra uma faixa "N hosts offline", em vez de esconder as sessões deles em silêncio.
- **Erros:** toast traduzido, com "Detalhes". Erros simultâneos não se apagam.
- **Sucesso:** toast curto em copiar, salvar, iniciar e outras ações.
- **Botões:** um botão em ação fica desabilitado e com spinner, sem duplo clique.
- **Confirmação** com `AlertDialog`, foco preso, `Esc` para cancelar e o botão destrutivo em vermelho com o verbo certo ("Remover host", "Encerrar sessão"), em:
  - remover host;
  - encerrar sessão;
  - descartar card;
  - limpar;
  - restaurar.
- **Remover host** sai de perto do `+` e vai para o menu do host.

## Lista de sessões (hub)

- **Linha:** título, `StatusBadge` colorido e host, mais origem e hora local numa segunda linha.
- **Destaque:** "Precisa de você" ganha fundo e ícone e sobe para o topo do grupo.
- **Ações:** num `DropdownMenu` no fim da linha, também visíveis no hover. Os ícones soltos saem.
- **Filtros:** persistem por janela e host. Ficam guardados no app, porque são conveniência de quem usa.

## Modo demonstração e prints

- **Entrada web:** `src/main.web.tsx` usa o `createWebPlatform` que já existe. O `main.tsx` continua com o Tauri. Uma variável do Vite escolhe a entrada.
- **`bun run demo`:**
  - sobe um daemon `--runtime fake` com dados semeados por `scripts/demo-seed.ts`:
    - dois hosts;
    - projetos;
    - cards em todas as colunas;
    - sessões rodando, ociosas, encerradas e do terminal;
    - pedidos de permissão de Bash e Write;
    - um gate aberto;
    - histórico, cota e custos;
    - **os estados difíceis, para os prints mostrarem:**
      - um host offline e um host incompatível, com um daemon falso de protocolo antigo;
      - um projeto vazio;
      - uma lista longa de sessões (60 ou mais) e um transcript longo, para conferir a rolagem;
      - um erro vindo do daemon;
      - aprovações de Bash, Write, Edit e de uma ferramenta MCP;
      - um texto muito longo num título.
  - sobe o Vite na entrada web, já pareado com o host de demonstração (por um link de pareamento local).
  - Nada sai da máquina, e nenhum dado real é usado.
- **CI:** um job `screenshots` (ubuntu, Playwright com Chromium).
  - Roda o demo e fotografa as telas principais nos dois temas e nos dois idiomas:
    - hub;
    - "Precisa de você", com o cartão aberto;
    - sessão;
    - board;
    - card com diff;
    - execução de workflow;
    - histórico;
    - host;
    - custos;
    - configurações;
    - paleta.
  - Publica os prints como artefato.
  - Também fotografa os estados difíceis: host offline e incompatível, projeto vazio, fim da lista longa (rolada) e erro.
  - As peças nativas não aparecem no navegador e ficam para a conferência no app instalado, no fechamento: bandeja, notificações, barra de título, atalho global, abrir no terminal e diálogo de salvar.
  - Roda também o `axe-core` nessas telas e reprova violações `serious` ou `critical`.
- **O orquestrador revisa os prints** a cada fase daqui em diante.

## Disciplina TDD

Segue [`docs/TDD.md`](TDD.md): ciclo por área, e a auditoria desde o commit-base da fase.

**Travas:**
- Os testes de componente usam happy-dom, como hoje, com `matchMedia` e `ResizeObserver` falsos para o Radix.
- O teste de i18n reprova texto visível fora do dicionário nas telas, com uma varredura de literais em JSX e uma lista curta de exceções.
- O teste de estilo reprova `style` com medidas e cor fora dos tokens.
- O Playwright e o `axe` rodam só no job `screenshots` e não contam para a cobertura.

## Migrações com trilhas em paralelo

Esta fase não cria tabelas. Se precisar, segue a regra das Fases 11 a 13: acrescenta no fim, renumera no rebase e nenhum teste fixa índice.

## Testes e critérios

| Área | O que precisa passar |
| --- | --- |
| `base-ui` | Tailwind v4 e shadcn instalados com versões fixas; `cn()`; tokens dos dois temas; `styles.css` antigo removido; lint de estilo |
| `layout` | `AppShell` com barra recolhível abaixo de 960 px; `Page` com rolagem própria (lista longa rola e o cabeçalho fica); `Grid` por colunas; `Stack` e `Inline` com a escala; os três estados padrão |
| `tema` | Claro, Escuro e Sistema; segue a mudança do sistema ao vivo; escolha guardada; janela do Tauri acompanha (plataforma falsa); contraste AA dos tokens de estado, calculado no teste |
| `i18n` | dicionários com as mesmas chaves (typecheck); idioma inicial pelo sistema; troca sem reiniciar; datas e horas locais; durações; plural; erros do daemon traduzidos por `code` com fallback; bandeja e notificações traduzidas; varredura de literais |
| `navegacao` | rota tipada com pilha; Alt+← e Alt+→; deep links viram rotas; abrir pedido, sessão ou card fecha Configurações, diálogo e paleta; "Iniciar card" pelo menu e pela paleta |
| `aprovacao-ui` | um componente para os três tipos de sessão; Bash com comando e `cwd`, Write e Edit com caminho e prévia, outras em chave e valor; atalhos A, N e Esc; motivo só depois de Negar; fila lateral com resumo e idade, expandindo ali |
| `estados-avisos` | skeleton com mínimo; vazio com ação; offline e reconectando distintos e faixa no hub; toasts de erro (sem se apagarem) e de sucesso; botão ocupado; confirmações com foco preso, Esc e verbo destrutivo |
| `hub-ui` | linha com badge, destaque de "precisa de você", menu de ações e filtros persistentes |
| `textos` | glossário aplicado; modos de permissão com nome e explicação; nenhum termo interno visível (lista proibida testada) |
| `demo-prints` | `bun run demo` sobe o daemon semeado e a entrada web pareada; job `screenshots` gera os prints de cada tela nos 2 temas e nos 2 idiomas; `axe` sem `serious` nem `critical` |

**Critérios de aceite**

- [ ] O vermelho por asserção de cada área mostrado antes da implementação.
- [ ] `tdd:audit` OK desde o commit-base.
- [ ] typecheck, lint e test com cobertura de 100%, exceto `src/components/ui/`, com a justificativa no DECISIONS.
- [ ] Todos os smokes.
- [ ] Os builds e o `cargo check` passam.
- [ ] CI verde, com o job `screenshots` publicando os prints.
- [ ] Nenhuma classe usada no TSX sem estilo, conferido por teste.
- [ ] Versões em `0.10.0`.
- [ ] README atualizado, com idiomas, tema e `bun run demo`, e `docs/GLOSSARY.md` criado.
- [ ] `docs/DECISIONS.md` atualizado e git limpo.
- [ ] Tag `fase-10` criada pelo orquestrador **depois de revisar os prints**.
