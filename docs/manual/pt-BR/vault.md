# Cofre

[Voltar ao manual](../pt-BR.md) · [English](../en/vault.md)

O **Cofre** (barra lateral) guarda segredos: chaves SSH, senhas, tokens e conjuntos de variáveis de
ambiente. O **valor** de um segredo fica no cofre de credenciais do sistema (Gerenciador de
Credenciais do Windows), nunca nos arquivos do app e nunca em um log. A lista da tela guarda só o
nome, o tipo, as etiquetas e uma descrição do segredo.

- **Novo segredo** pede nome, tipo, valor e etiquetas. **Gerar chave SSH** cria um par `ed25519`
  com o `ssh-keygen` deste computador, guarda a chave privada no cofre, apaga o arquivo temporário
  e mostra a chave pública, pronta para **Copiar chave pública**. **Importar arquivo de chave** lê
  um arquivo que você escolhe no diálogo do sistema; o original fica onde está, a menos que você
  marque **Apagar o arquivo original depois de importar**.
- Cada linha mostra só o que é seguro mostrar: a impressão digital da chave pública, o começo e o
  fim de um token (`ghp_…WXYZ`, e nada para um token curto) ou os nomes de um conjunto de
  variáveis. Uma senha não mostra nada.
- **Revelar** pede que você digite a palavra `revelar` e então mostra o valor por 10 segundos.
  **Copiar** coloca o valor na área de transferência e a limpa 30 segundos depois. **Remover** pede
  que você digite o nome do segredo e apaga também o valor do cofre do sistema.
- **Uso** é o registro de cada pedido feito ao cofre: o segredo, o host, a finalidade, quem pediu
  (você, o Claude, uma automação ou um workflow) e o resultado (entregue, negado ou usado). Ele
  nunca guarda um valor. Filtre por segredo ou por quem pediu.
- **Backup** exporta o cofre para um arquivo `cofre.fdvault`, cifrado com a frase-senha que você
  digitar (pelo menos 12 caracteres, confirmada duas vezes). **Importar cofre** lê esse arquivo com
  a frase-senha e mostra uma prévia dos segredos **Novos**, **Iguais** e **Conflitantes** antes de
  mudar qualquer coisa; um conflito mantém o que está no cofre, a menos que você escolha
  **Substituir pelo backup**. Uma frase-senha errada e um arquivo alterado são recusados.

Um segredo só chega a um daemon quando o app o envia, só para um host da lista de hosts permitidos
do segredo e só por `localhost` ou Tailscale; o daemon o guarda na memória por no máximo 60
segundos. Nesta versão nenhuma função do daemon pede segredos ainda, então todo pedido vindo de um
daemon é negado.

## Backup de tudo

**Configurações > Backup** salva um arquivo cifrado com as configurações, personas, snippets, hosts
(com os tokens) e o cofre. Digite uma frase-senha (pelo menos 12 caracteres, duas vezes) e use
**Fazer backup agora**; o diálogo de salvar do sistema pergunta onde. Só essa frase-senha abre o
arquivo, então guarde-a.

Para **Restaurar um backup**, digite a frase-senha do arquivo e use **Ler backup**; depois escolha o
arquivo. O Flightdeck mostra, para cada tipo, quantos itens são novos, iguais ou diferentes aqui, e
lista os diferentes pelo nome. Um host aparece com o endereço para onde aponta, como
`alfa (ws://100.64.0.2:7420)`, para você ver qual máquina volta; um login ou uma query no endereço não
aparece. Onde o app não consegue abrir arquivos, a seção diz que restaurar precisa do app para
desktop, em vez de oferecer **Ler backup**. Nada muda até você usar **Restaurar**: uma diferença mantém o que está
aqui, a não ser que você escolha **Substituir pelo backup**, que pede confirmação. A restauração é
tudo ou nada: se falhar no meio, tudo volta como estava. Uma frase-senha errada e um arquivo alterado
são recusados, e nada muda. Feche e abra o Flightdeck de novo para usar as configurações e os hosts
restaurados. Personas e snippets que um host guarda, ou que vêm de um repositório, não vão no
arquivo.

Os **Backups agendados** (só no app para desktop) ficam logo abaixo, na mesma seção. Escolha **Todo
dia** ou **Toda semana**, escolha uma pasta em **Escolher pasta** e defina **Arquivos a manter** (5
por padrão): depois de cada backup os mais antigos saem, e só arquivos com nome de backup do
Flightdeck são tocados. O backup é cifrado como o de cima, então o Flightdeck pede a frase-senha uma
vez a cada abertura; ela fica na memória até você fechar o app e nunca é salva. Enquanto você não a
der, um backup devido espera, e a seção avisa. Um backup que não pôde ser salvo também aparece ali, e
a data do último bom continua. O sino também avisa, uma vez por abertura, quando um backup não pode
sair: falta a frase-senha, não há pasta escolhida ou um backup falhou. Um clique no aviso abre
**Configurações**, seção **Backup** (#1327).

Quando o build traz um cliente do Google, **Onde salvar** também oferece **Google Drive**. Ele guarda
os backups na pasta oculta do próprio Flightdeck no seu Drive, que só este app enxerga, e cada
arquivo continua criptografado com a sua frase-senha. **Entrar com o Google** abre a página do Google
no navegador e o app espera a resposta só neste computador. O Flightdeck guarda o token no cofre,
nunca num arquivo nem num log; **Sair** o remove. Se o Google deixar de aceitar a entrada, a seção e
o sino avisam e nenhum backup é feito até você entrar de novo. Sem um cliente no build, a escolha não
aparece (#1444).

Para restaurar do Drive, **Backup de tudo** > **Restaurar um backup** oferece **Restaurar de**:
**Um arquivo** ou **Google Drive** (só com o mesmo cliente do Google, e depois de entrar). **Procurar no
Google Drive** lista os backups de lá, do mais novo ao mais antigo. Escolha um, digite a frase-senha e
**Ler backup**: você vê a mesma prévia de um arquivo, e nada muda até você confirmar (#1462).
