# Issues, automações e arena

[Voltar ao manual](../pt-BR.md) · [English](../en/issues-automations-and-arena.md)

Três coisas da Fase 13, no board e na lista de projetos. Cada uma só aparece quando o daemon anuncia
o recurso (`issues`, `automation`, `arena`; daemon 0.13.0 ou mais novo). Com um daemon mais antigo, os
botões simplesmente não existem.

## Issues

O botão **Issues** no cabeçalho do board abre um painel lateral com as issues do projeto no GitHub
(pelo `gh`) ou no Azure Boards (pelo `az`). Antes, conecte um provedor pelo mesmo botão: **Conectar
issues** pergunta o provedor e uma busca opcional (em branco, as abertas atribuídas a você) e pode
permitir que o daemon comente na issue quando o PR abrir (desligado por padrão, porque escreve no
provedor).

- **Filtrar issues** reduz a lista por título, rótulo ou autor.
- **Criar card** faz um card no Backlog a partir da issue e guarda o link: a linha passa a oferecer
  **Abrir card**, o card mostra a issue (um botão que a abre no navegador) e um PR que fecha o card
  fecha a issue (`Fixes #n` ou `AB#id`).
- Uma issue de **Autor externo** vem marcada. O texto é conteúdo de terceiro: a aprovação automática do
  card fica suspensa até você reativá-la.
- Só endereços `http` e `https` são abertos.

## Automações

Em **Projetos**, cada projeto tem um botão **Automações** (num daemon que anuncia automação). A tela lista
as automações do projeto, cada uma com gatilho, ação, limite por dia, a marca **Aceita autores externos**
e um interruptor.

- **Nova automação** é um formulário guiado em três passos: gatilho (horário com cron e fuso, comentário
  novo no PR de um card, checks do PR de um card que falharam, ou issue nova com um rótulo), ação (iniciar um
  workflow, enviar o conteúdo do evento à sessão do card, ou criar um card a partir da issue; a lista só
  oferece as ações que combinam com o gatilho) e limite (nome, disparos por dia e se também age sobre
  autores externos, desligado por padrão).
- Uma automação **sempre nasce desligada**, também depois de editar. Ligar mostra antes o gatilho e a ação e
  pede **Ligar**; desligar não pede nada.
- O **Histórico** lista os disparos: Executou, Falhou, Ignorado, Pulado, Limite do dia ou Perdido (um horário
  que caiu com o daemon parado; é registrado, não recuperado).
- Um disparo que falha não repete sozinho, e as filas por cota e por orçamento continuam valendo.

## Arena

Num card que ainda não começou, **Iniciar em arena** roda o mesmo pedido em 2 a 4 **variantes**, cada uma com
o próprio modelo e esforço (em branco, o padrão do host), em worktree e branch próprias (`fd/<slug>-a`,
`-b`...). **Adicionar variante** e **Remover variante** mudam a contagem. Cada variante ocupa uma vaga do
limite de execuções em paralelo e espera na fila quando não há.

O card passa a mostrar a **Comparação da arena**: uma coluna por variante com modelo e esforço, estado,
duração, custo estimado, arquivos alterados e checks do workflow, e **Ver mudanças** para o diff da própria
variante. **Escolher a variante X** fica disponível quando a variante parou; pede confirmação, faz daquela
worktree a do card e para e remove as outras.
