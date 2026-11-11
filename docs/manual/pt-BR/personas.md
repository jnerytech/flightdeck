# Personas

[Voltar ao manual](../pt-BR.md) · [English](../en/personas.md)

Uma **persona** é um papel de engenharia que o Claude assume numa sessão: nome, descrição, ícone,
modelo, esforço, ferramentas e modo de permissão sugeridos, e as instruções do papel. A tela
**Personas** (barra lateral, para hosts que as guardam) lista pelo lugar onde ficam:

- **Pacote**: treze vêm prontas, em português e inglês (arquiteto, revisor de segurança, QA, SRE,
  performance, revisor de código, docs, frontend, **UX** (avalia se uma pessoa consegue concluir uma
  tarefa e só recomenda: não tem ferramenta de edição), **UI** (mantém a interface consistente com o sistema de
  design e a corrige em PRs pequenos), DBA, o coordenador de time da Fase 21 e o
  **Desenvolvedor**, o que escreve o código: teste primeiro, mudanças pequenas e no escopo, segue o
  CLAUDE.md e os ADRs do projeto, roda as checagens do projeto antes de dizer que terminou, nunca
  faz push). Editar
  uma guarda a sua versão no host (**Pacote, editada**); **Restaurar original** traz a do pacote.
- **Host**, **Projeto** (escolha um: as dele e as versionadas em `.flightdeck/personas/*.md`, que
  você **Confia** antes) e **Globais (deste app)**, guardadas no app.
- **Nova persona** e **Editar** abrem o editor com uma **Prévia** do que a sessão recebe. **Editar**
  abre o formulário dentro do cartão da própria persona, com o primeiro campo em foco e o cartão
  trazido para a tela; **Nova persona** abre no topo. **Cancelar** e **Salvar** devolvem a rolagem
  e o foco ao botão Editar. **Modelo** é uma escolha (**Outro…** para texto livre) e
  **Ferramentas** uma seleção múltipla. Uma persona nunca guarda segredo: a que tiver é recusada
  com o motivo.
- **Publicar como agente** grava a persona em `.claude/agents/persona-<id>.md` pelo
  editor de agentes, com confirmação, e ela vale também para o `claude` puro.

Para usar:

- **+ Nova sessão**, **Ctrl+K** (**Nova sessão como <persona>**), **Persona do card** ao lado de
  **Iniciar** (sugere o Desenvolvedor, quando o host o tem; escolha **Nenhuma** para iniciar sem persona) e cada variante de **Iniciar em arena** têm um campo **Persona**. A sessão abre nela:
  as instruções vão depois do prompt do sistema, com o modelo, o esforço e as ferramentas sugeridos.
  Uma persona só tira: as ferramentas dela são parte das da sessão, e o modo dela só vale quando é
  menos permissivo.
- **Claude aqui** tem o seu seletor e roda `flightdeckd claude --persona <id>` (as do host, do
  projeto e do pacote; as do app não têm id no host).
- Numa sessão aberta (gerenciada, ou do terminal que você controla), **Aplicar persona** manda o
  papel como mensagem, e **Voltar ao normal** encerra. O app avisa: numa sessão aberta, a persona
  vale como instrução da conversa, não do sistema. Depois de cada clique ele também diz como a
  instrução foi: **enviada** a uma sessão ociosa, **na fila** atrás do passo atual ou de um pedido
  de permissão pendente (segue assim que for respondido) ou **enviada à sessão do terminal** (ela
  aparece na conversa quando o Claude a receber, depois de qualquer pedido pendente). O **Claude
  aqui** com persona é diferente: abre uma nova sessão de terminal com a persona no prompt do sistema.
- **Personas como subagentes**, na tela de agente do projeto: **Todas** (do pacote, do host e do
  projeto), **Só as do projeto** ou **Nenhuma**. Elas chegam às sessões como agentes
  `persona-<id>`, para o Claude delegar.
- O formulário do projeto tem uma **Persona padrão** por coluna do board: um card que inicia daquela
  coluna abre nela, a não ser que você escolha outra.
- A lista de sessões mostra a persona de cada uma e filtra por ela; **Custos** tem **Por persona**.
