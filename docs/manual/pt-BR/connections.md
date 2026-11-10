# Conexões

[Voltar ao manual](../pt-BR.md) · [English](../en/connections.md)

**Conexões** (barra lateral, para hosts que guardam destinos SSH) lista os **destinos** cadastrados
no primeiro host online que os anuncia e abre cada um numa tela de terminal com o cliente OpenSSH
desse host. O Flightdeck não tem cliente SSH próprio: ele monta o comando `ssh` como uma lista de
argumentos, sem shell no meio, e nunca guarda uma senha nem uma chave, só a referência a uma (o
caminho de um arquivo de chave).

- **Conectar** confere antes a chave do servidor. Um servidor nunca visto mostra o **fingerprint
  SHA256** e espera **Confirmar chave do servidor**; só então o terminal abre. As conexões seguintes
  usam um arquivo known_hosts próprio do Flightdeck e exigem que a chave seja a mesma. Uma **chave
  trocada bloqueia a conexão** e mostra o fingerprint guardado e o novo; nada conecta até você abrir
  o destino e escolher **Esquecer chave do servidor**.
- **Novo destino**, **Editar**, **Duplicar** e **Remover** (com confirmação). Um destino tem nome,
  host, porta, usuário, autenticação (o **agente SSH** do host, ou um **arquivo de chave** pelo
  caminho), o host que o abre, um **salto** opcional (outro destino), etiquetas e uma lista curta e
  fixa de opções: segundos de keep-alive, compressão, encaminhamentos locais em texto e
  **ForwardAgent**, que vem desligado e pede confirmação para ligar.
- **Testar conexão** (no formulário de edição) roda o `ssh` sem terminal e diz "Conexão ok." ou o
  erro em palavras. Não cobre senhas.
- **Importar do SSH config** lê o `~/.ssh/config` do host (só leitura, nunca escreve), lista os
  nomes que achou, marca os já cadastrados e cria só os que você marcar. Entradas com curinga (`*`,
  `?`) são padrões para as outras, não destinos.
- **Busca** por nome, host ou usuário; filtro por etiqueta e pelo host que abre o destino. O
  **Ctrl+K** também oferece **Conectar a <nome>** para cada destino.
- A aba de terminal de um destino se chama "SSH · nome" e leva as etiquetas. Um destino com a
  etiqueta `prod` ou `produção` deixa essa **aba com borda vermelha**, para um servidor de produção
  não ser confundido com outro.

Um destino também pode usar a autenticação por **Senha**: quando o ssh pergunta, o app abre uma
janela com o campo mascarado (ou uma para a frase de uma chave). A resposta vai ao host uma vez,
nunca é guardada nem registrada, e **Cancelar** faz o ssh falhar na hora. Com o Cofre, a
autenticação por **Chave do cofre** escolhe uma chave SSH do cofre (e **Senha** pode apontar para
uma senha do cofre, que então responde ao ssh sem janela). A chave vai ao host que roda o ssh, no
comando de conexão e em mais nenhum lugar, só se o segredo estiver liberado para esse host e a
conexão for `localhost` ou Tailscale; cada uso aparece na aba **Uso** do cofre com a finalidade
`ssh`, pedido por **Você**.

Um destino com **host que o abre** diferente do que o guarda roda o ssh lá (por exemplo uma VPS,
para alcançar a rede interna dela): o Flightdeck guarda uma cópia do destino nesse host e avisa na
tela se o host está offline ou sem suporte a SSH.
