# Ações: o Claude usa um segredo sem vê-lo

[Voltar ao manual](../pt-BR.md) · [English](../en/actions-claude-uses-a-secret-without-seeing-it.md)

Uma **ação** é um comando que você declara, com lugares para segredos do cofre e para parâmetros.
O Claude a chama pelo nome e só escolhe os parâmetros que você permitiu. O daemon aplica o segredo
do lado dele e entrega ao Claude o código de saída e a saída (até 32 KB) com o segredo mascarado
como `•••(nome)`. As ações precisam do cofre (um segredo guardado no app) e de um daemon que as
tenha: o botão **Ações de <projeto>** só aparece nesse caso.

```yaml
# .flightdeck/actions.yaml (versionado, sem segredos) ou a tela Ações do projeto
- name: deploy-staging
  description: Faz o deploy da branch na VPS de staging
  run: ["./scripts/deploy.sh", "{{param.branch}}"]
  cwd: /srv/app
  env:
    DEPLOY_TOKEN: "{{secret.deploy-token-staging}}"
  params:
    branch: { pattern: "^[a-zA-Z0-9._/-]{1,80}$", default: main }
  timeoutS: 600
  approval: first-per-session   # always | never | first-per-session
```

- `run` é uma lista de argumentos e nunca passa por shell. O segredo vai só para o `env` ou para um
  arquivo temporário (`{{secretFile.x}}`, apagado depois), nunca para um argumento, porque
  argumento aparece na lista de processos.
- Cada parâmetro precisa casar o `pattern` inteiro, e um `{{param.*}}` não pode ocupar a posição de
  código de um interpretador (depois de `-c`, `-e`, `/c`, `-Command`, `-EncodedCommand` ou `eval`).
- `ssh: <destino>` roda a ação no destino SSH (Fase 15) com esse nome, onde o Claude não tem shell.
  O comando chega com cada palavra entre aspas e o ambiente vai pela entrada padrão; um destino que
  entra com uma chave do cofre a recebe só para aquela execução. Um destino com senha não roda
  ações.
- `approval` vale `first-per-session` por padrão para uma ação com segredo e `never` para uma sem.

## A tela Ações

- Cada ação mostra a descrição, onde roda (este host, um host nomeado ou um destino SSH), como pede
  aprovação, os segredos e os parâmetros que usa, e se foi **Criada no app** ou é **Versionada**. Os
  problemas do `.flightdeck/actions.yaml` aparecem acima (as ações válidas continuam carregando).
- **Confiança.** Uma ação criada no app já nasce confiada. Uma versionada mostra **Não confiada**
  até você apertar **Confiar em <nome>** e confirmar; a confirmação mostra o que ela executa. A
  confiança fixa a declaração e o sha256 do `run[0]` e de cada arquivo do argv que está dentro de
  um repositório git, e o daemon confere de novo logo antes de cada execução. Se algum mudou, a ação
  mostra **Mudou desde que foi confiada** com o que mudou, e só roda de novo depois que você
  confiar outra vez.
- **Nova ação** abre um formulário: o nome, uma descrição, o comando com um argumento por linha,
  um destino SSH, a pasta, o tempo limite e a aprovação (opcionais), as variáveis de ambiente que
  recebem um segredo do cofre (o seletor mostra nomes e tags, nunca um valor) e os parâmetros com
  o padrão e o valor inicial. O daemon confere, e o que ele recusa aparece no formulário. **Editar**
  e **Remover** (que pergunta antes) ficam nas ações criadas no app; uma ação versionada muda no
  arquivo dela.
- **Aviso de produção.** Uma ação que roda neste host com um segredo de tag `prod` avisa na linha
  dela: uma sessão do Claude com Bash neste host poderia ler o segredo enquanto ela roda. Prefira
  uma ação `ssh:` para ele.
- **Execuções.** **Execuções de <nome>** abre o histórico, da mais nova para a mais antiga:
  quando, quem pediu (Você, Claude, Automação ou Workflow), o código de saída, a duração e a saída,
  já mascarada pelo daemon.

## Aprovar um pedido

Quando o Claude, uma automação ou um workflow roda uma ação que precisa de um segredo, o pedido
aparece em **Precisa de você** com uma notificação: quem pediu, a ação e os parâmetros (ou o
comando, os segredos e o host). **Aprovar** entrega o segredo só para aquela execução; **Negar**
faz a execução falhar na hora. Uma ação com `approval: never` roda sem pergunta, `first-per-session`
pergunta uma vez e fica lembrada até o app reiniciar, e `always` pergunta todas as vezes. Um
`run_with_secret` é de risco alto: segure o botão por 2 segundos para aprovar; a bandeja só
oferece Negar e Abrir.

## Regras de uso por segredo

Cada segredo tem uma lista ordenada de regras: a primeira que casa com um uso decide, e sem regra
vale o padrão seguro (você: permite; o Claude com uma ação declarada: pergunta uma vez por sessão;
`run_with_secret`: pergunta a cada uso; automações e workflows: nega; tag `prod`: pergunta a cada
uso, segurando o botão). **Regras de <segredo>** na tela do cofre as edita: quem pede, a
finalidade, a ação (com `*`), host, tags, projeto, sessão, a decisão (uma vez por sessão com
**Perguntar**), uma janela no relógio deste computador com o que vale fora dela, limites por hora e
por dia, e uma expiração. Mude a ordem com **Subir**, **Descer** ou arrastando.

- **O teto:** uma regra pode afrouxar um padrão, mas nunca permitir `run_with_secret`, nem permitir
  um segredo `prod` sem janela. Os hosts conferem as regras quando você salva, e o que recusam
  aparece com o motivo.
- **O que acontece se…** abaixo das regras pergunta a um host conectado o que as regras salvas
  decidem para um uso: a decisão, o motivo, se pergunta uma vez por sessão, se segura o botão ou se
  bateu um limite.
- **Aprovar:** o pedido mostra a regra que decidiu e o motivo. Onde a regra permite,
  **Aprovar e não perguntar mais nesta sessão** aprova o resto daquela sessão. **Criar regra a partir disto** abre
  as regras do segredo com uma regra nova no topo para quem pediu, a finalidade e a ação.
- **Relatório:** a aba **Relatório** do cofre mostra os últimos 30 dias por segredo, quem pediu e
  resultado, com **Exportar CSV**, e cada decisão com quem deixou passar. O primeiro uso por quem
  nunca pediu mostra um alerta, mesmo quando uma regra permitiu.

## Como o Claude chama uma ação

- **MCP (`flightdeckd mcp`):** `list_actions` (nome, descrição e parâmetros, nunca segredos),
  `run_action { name, params }` e `run_with_secret { command, secrets, host }`. A última é um
  comando escrito pelo próprio Claude, com os segredos no ambiente: **sempre** pede a sua
  aprovação, com o comando, os nomes dos segredos e o host, e nunca é automática, nem com a
  aprovação automática. Não existe "permitir sempre" aqui.
- **O mod `flightdeck`** (`mods/flightdeck`, instale com `/plugin install`) registra as mesmas
  ferramentas para sessões do terminal sem o MCP, mostra uma faixa "ação rodando" e o comando
  `/flightdeck`. As ferramentas são `mcp__flightdeck__*`, o mesmo prefixo de um servidor MCP
  adicionado como `flightdeck`; ligue só um dos dois numa sessão. (Antes da Fase 21 ele se
  chamava `flightdeck-actions`.)
- **A máscara** troca o valor entregue, cada linha de um valor de várias linhas e as formas dele em
  base64, URL-encode e hex. Um segredo transformado de outro jeito (um hash, um corte no meio) não
  é pego; por isso a ação declarada é o caminho seguro, e o comando livre não.

## O limite: o mesmo usuário do sistema

A garantia é que o segredo nunca chega ao transcript nem ao contexto do modelo pelo Flightdeck. Não
é isolamento contra um processo hostil do mesmo usuário: enquanto a ação roda, o ambiente dela
(`/proc/<pid>/environ` no Linux) e o arquivo temporário podem ser lidos por outro processo do mesmo
usuário do sistema operacional, e uma sessão do Claude com Bash no **mesmo host** consegue lê-los.
Segredos de produção ficam em ações `ssh:`.

Num terminal, uma ação sai mascarada quando roda por `flightdeckd action run` (o que o mod
`flightdeck` usa): o que ela imprime é o resultado já mascarado pelo daemon. O resto do que
um terminal mostra não é mascarado.
