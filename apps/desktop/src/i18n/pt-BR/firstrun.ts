/** The first-run screens: the empty start, the welcome and the setup. */
export const firstrun = {
  start: {
    title: "Nada aberto",
    addHost: "Adicionar um host",
    subtitle: "Escolha uma tela na barra lateral ou comece por aqui.",
    recent: "Sessões recentes",
    shortcuts: "Atalhos",
    shortcut: {
      search: "Buscar",
      newTab: "Nova aba",
      reopen: "Reabrir a aba fechada",
      split: "Dividir a janela",
    },
  },
  welcome: {
    /** The first-run screen's title, and the Add host screen's once a host exists (#728). */
    title: "Conecte seu primeiro host",
    titleMore: "Adicionar um host",
    crumb: "Conectar um host",
    addHost: "Adicione um host com o endereço e o token do flightdeckd.",
    stepsLabel: "Primeiros passos",
    step1: "No computador que roda o Claude Code, instale e inicie o daemon:",
    step2: "Copie o link de pareamento que ele mostra no final (também mostra um QR code).",
    step3: "Cole o link abaixo e clique em Testar e adicionar.",
    step4:
      "Pronto: o app abre a página do host, onde você verifica o host e escolhe as pastas de projetos.",
    trouble:
      "Não conectou? No mesmo computador, rode o comando abaixo: ele diz o que falta e como consertar.",
    copy: "Copiar {command}",
  },
  setup: {
    title: "Configuração inicial",
    row: "Configuração inicial, {done} de {total} passos feitos",
    count: "{done}/{total}",
    ring: "{done} de {total} passos feitos",
    hide: "Esconder a lista de configuração inicial",
    subtitle:
      "O que está configurado e o que não está, lido dos seus hosts e do app. Nada aqui é marcado à mão.",
    core: "Para começar",
    optional: "Vale a pena",
    allDone: "Tudo para começar está feito. A lista sai da barra lateral sozinha.",
    done: "Feito",
    todo: "A fazer",
    go: "Abrir",
    restore: "Mostrar a lista de configuração inicial",
    step: {
      host: {
        title: "Conectar um host",
        text: "Um host é uma máquina que roda o flightdeckd. Adicione um para ver as sessões dele.",
        action: "Adicionar um host",
      },
      hooks: {
        title: "Instalar os hooks do Claude Code",
        text: "Os hooks deixam uma sessão que você inicia num terminal ser vista e aprovada aqui.",
        action: "Abrir o host",
      },
      project: {
        title: "Adicionar um projeto",
        text: "Um projeto é uma pasta com um repositório git e um branch base. Os cards e os workflows ficam nele.",
        action: "Adicionar um projeto",
      },
      session: {
        title: "Iniciar uma primeira sessão ou card",
        text: "Inicie uma sessão num projeto, ou um card no board dele.",
        action: "Nova sessão",
      },
      github: {
        title: "Entrar no GitHub no host",
        text: "Com o gh do host conectado, pull requests e issues funcionam.",
        action: "Abrir o host",
      },
      notifications: {
        title: "Conferir se as notificações funcionam",
        text: "Envie uma notificação de teste e veja-a aparecer.",
        action: "Abrir Configurações",
      },
      budget: {
        title: "Definir um orçamento",
        text: "Um limite avisa antes de um projeto ou host gastar mais do que você quis.",
        action: "Abrir Configurações",
      },
      worktreeinclude: {
        title: "Adicionar um .worktreeinclude a um projeto",
        text: "Ele lista os arquivos não versionados (como o .env) que o worktree de um card deve receber.",
        action: "Abrir projetos",
      },
    },
    tools: {
      title: "{tool} não está em {host}",
      text: "Alguns recursos precisam dele.",
      fix: "Como instalar",
      dismiss: "Dispensar",
    },
  },
} as const;
