# Clientes: agrupar o trabalho entre hosts e projetos

[Voltar ao manual](../pt-BR.md) · [English](../en/clients-grouping-work-across-hosts-and-projects.md)

Um **host** é uma máquina e um **projeto** é um repositório (ou uma pasta). Quem trabalha para vários
clientes, com várias máquinas e muitas pastas, usa o **cliente** para agrupar projetos entre hosts:
ele é guardado pelo app, atravessa os hosts e **nunca é obrigatório**. Sem nenhum cliente, o app é
e age como antes (a única diferença é uma linha nas **Configurações**). Os hosts não ficam sob um
cliente, porque uma máquina costuma servir vários.

**Criar clientes.** Abra **Gerenciar clientes** (a linha nas **Configurações**, o **Ctrl+K** ou o
seletor, depois que existe um cliente). **Criar cliente** pede um nome (único, sem diferenciar
maiúsculas); cada cliente tem uma cor, pode ser renomeado, subir ou descer e ser excluído (os
projetos dele voltam às regras dos outros ou ficam sem cliente; nada é apagado dos hosts). A ordem
dos clientes é a ordem em que as regras são tentadas.

**Regras.** Um projeto entra no cliente pela primeira regra que casa com ele:

- **Remoto**: um prefixo do remoto do projeto, com `*` no fim (`github.com/acme/*`,
  `dev.azure.com/orgb/*`) ou um repositório exato. O mesmo repositório em duas máquinas é um só
  projeto, então uma regra cobre os dois.
- **Pasta**: um prefixo absoluto de pasta (`/home/eu/trabalho/acme`, `C:\trabalho\acme`), para
  qualquer host ou para um (escolhido pelo nome). Não há `~`: o host não diz ao app qual é a pasta
  pessoal dele. Uma regra de pasta também pega um projeto conhecido pelo remoto quando alguma pasta
  em que suas sessões rodaram está dentro do prefixo. Uma regra cujo host foi removido ou pareado
  de novo mostra **host desconhecido** e não casa com nada. Se dois hosts têm o mesmo nome de
  daemon, um projeto conhecido só pela pasta não casa com regra de um host só, e a tela avisa.
- **À mão**: **Atribuir**, num projeto sem cliente, prende o projeto a um cliente, e **Projetos
  fixados à mão** lista as fixações (**Soltar** desfaz uma). A fixação vale mais que as regras.

O formulário de cada regra mostra com quantos projetos ela casa agora. **Sugerir a partir do que
tenho** oferece um cliente por dono dos remotos que o app já viu (`github.com/acme`, uma
organização do Azure DevOps), o maior primeiro; nada é criado até você clicar, e um dono que já tem
cliente recebe a regra nele. Os projetos que nenhuma regra ou fixação pega ficam **Sem cliente**; a
tela os conta. **Exportar clientes** mostra a configuração como texto e **Importar** junta o texto
colado por id de cliente (os novos entram, o mesmo id é trocado, nada é apagado), para levar a
configuração a outro computador.

**O seletor.** Depois que existe um cliente, um menu abaixo da marca, na barra lateral, escolhe
**Todos os clientes**, um cliente (com as sessões que rodam ou esperam) ou **Sem cliente** (com a
quantidade de projetos). Uma marca ao lado conta os pedidos que esperam em *outros* clientes. A
escolha fica guardada entre as aberturas, e o **Ctrl+K** tem as entradas **Cliente: <nome>**. **Alt+Shift+C** passa para o próximo: todos os
clientes, cada cliente na ordem, **Sem cliente** e de novo todos (não faz nada antes de existir um cliente).

**O que a escolha filtra.** Sessões (e um selo do cliente em cada cabeçalho de projeto enquanto
todos os clientes aparecem), a escolha de projeto de Board e Workflows, Conversas (uma mensagem
aparece quando qualquer das duas sessões é do cliente), Orçamentos (os orçamentos do próprio host
sempre aparecem, e uma linha conta os escondidos), Custos e o Cofre. Nunca filtra **Precisa de
você**, a bandeja, as notificações, os alertas de orçamento nem a busca global, e cada pedido ali
leva o selo do cliente. A tela **Projetos** do próprio host sempre lista todos os projetos.

**Custos e orçamentos.** Em **Custos**, o menu **Dados de** na barra de ferramentas (o mesmo do
Início, guardado entre aberturas) escolhe **Todos os hosts**, que é como os Custos abrem e soma os
hosts, ou um host. Um link que nomeia um host (um alerta, um cartão do Início) mostra esse host
naquela visita e não mexe na escolha do menu. Se o host escolhido está offline ou não informa
custos, os Custos dizem isso e oferecem **Mostrar todos os hosts**. **Por cliente** divide o gasto
(com **Sem cliente**) e um cliente escolhido restringe tudo; um host que está offline, não tem
custos ou não responde é citado. A exportação CSV cobre todos os hosts em **Todos os hosts**, com o
nome do host na primeira coluna (um host que não responde fica de fora). Os gráficos de cota são
por host: em **Todos os hosts** há uma linha, **Escolha um host para ver a cota**, com um botão por
host. Um projeto cujo nome também é de um projeto em outro host aparece com o host
(`docs-site · alfa`), igual no Início e nos Custos, mesmo quando só um deles está na lista da
tela. Cada
cliente pode ter um **limite mensal** (US$): o app confere quando um host com custos entra no ar,
quando você muda o limite e a cada dez minutos, avisa uma vez por mês em 50%, 80% e 100% (uma
notificação e uma linha em **Precisa de você**) e **não segura cards**: os limites de cada host e
projeto continuam nos hosts.

**Padrões.** Cada cliente pode ter uma **persona padrão** (já escolhida em **Nova sessão**, a partir
da pasta que você escolhe, e em **Claude aqui**; dá para trocar, e uma persona com que a tela foi
aberta vale mais) e uma **tag de snippets** (os snippets do cliente vêm primeiro em **Snippets** e no
**Ctrl+K**, e um snippet novo já nasce com ela). Os cards mantêm a persona do projeto por coluna.

**Cofre.** Um cliente pode ter uma **tag do cofre**: com o cliente escolhido, os segredos com a tag
vêm primeiro no **Cofre**, depois os de nenhum cliente e os de outros clientes (nada some), e um
segredo novo já nasce com a tag. A tela de Clientes lista, só para leitura, um segredo com a tag que
tem uma regra que libera ou pede o projeto de outro cliente, ou cujos hosts permitidos incluem um
que não tem nenhum projeto do cliente. **Manter os segredos com essa tag só nos projetos do
cliente** é opcional: depois de uma confirmação que mostra quantas regras cada segredo recebe, o app
manda aos hosts, na frente das regras do próprio segredo, uma regra de **pedir** por projeto do
cliente e uma de **negar** para o Claude, as automações e os workflows em qualquer outro lugar (o
seu uso no app não é negado, e o daemon segue limitando as regras ao seu teto). Essas regras são
geradas, não salvas: o editor de regras mostra só as suas e diz quantas vêm antes, elas acompanham
os projetos do cliente (com um aviso) e desligar o escopo manda de novo exatamente as suas regras.
O escopo só vale enquanto **este** desktop escreve as regras do segredo: se outro app as salvar num
host, o app percebe ao conectar, avisa e as envia de novo; um host que as recusa (o daemon aceita
no máximo 200 regras por segredo) é citado, e o segredo então não fica preso ao cliente nesse host.
