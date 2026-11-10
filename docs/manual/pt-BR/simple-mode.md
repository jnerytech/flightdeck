# Modo simples

[Voltar ao manual](../pt-BR.md) · [English](../en/simple-mode.md)

O modo simples é uma face mais calma do mesmo app, para quem não usa terminal. Ele muda só o jeito
de ver um host, não o que ele faz: as sessões, as permissões e os arquivos são os mesmos.

**O que você vê.** Um menu estreito com três lugares: *Início*, *Arquivos* e *Configurações*.

- *Início* pergunta "O que você quer que seja feito?". Abaixo, duas linhas dizem o que é uma tarefa
  (o Claude trabalhando nos seus arquivos neste computador) e em qual computador as tarefas rodam,
  com a conexão dele. Se esse computador não está conectado, não aceita o app ou precisa de uma
  atualização, um aviso diz o que fazer e *Começar esta tarefa* fica parado; se nenhuma pasta foi
  liberada ainda, uma nota com um botão abre as *Configurações* para adicionar uma. As tarefas
  prontas são cartões (resumir uma pasta, redigir um relatório, revisar um documento, comparar
  arquivos); cada cartão lista as perguntas e diz se só lê os seus arquivos, pergunta antes de mudar
  qualquer coisa ou edita a pasta que você escolher. As tarefas que esperam por você vêm primeiro,
  depois as recentes; antes da primeira, três passos mostram como uma tarefa acontece: escolher um
  cartão, responder às perguntas, receber o que foi feito na pasta *Flightdeck results*, dentro da
  pasta que você escolheu.
- Uma *tarefa* mostra numa linha o que está fazendo, faz as perguntas em palavras simples com
  **Sim, pode continuar** e **Não** (e avisa quando algo não pode ser desfeito) e, ao terminar, mostra um resumo e
  os arquivos que fez. Abra um arquivo, mostre-o na pasta ou peça mudanças. *Mostrar detalhes* abre
  a visão completa da sessão.
- *Arquivos* lista o que as tarefas recentes fizeram, do mais novo ao mais antigo.
- *Configurações* tem o idioma, o tema, as pastas que as tarefas podem usar, as notificações e
  *Mostrar tudo*, que volta ao app completo depois de uma confirmação.

**Fora da janela.** As notificações, a bandeja e o título da janela seguem o modo do host que as
gerou (o título da janela segue o host que você está vendo). Para um host em modo simples a notificação tem o título "<host · tarefa>: esperando a sua
resposta" e diz em palavras simples o que a tarefa quer, em vez de "precisa de você / Permitir
Write?". Quando
esse host está em modo simples, o título da janela vira "Flightdeck: 2 tarefas esperando a sua
resposta"; o texto da bandeja diz o mesmo quando todos os hosts que esperam estão em modo simples. Hosts em modo completo
mantêm o texto técnico.

**Segurança.** Uma tarefa nunca pula as perguntas: ela só pode ler, perguntar antes de mudar ou
editar a pasta escolhida. Os resultados vão para uma pasta *Flightdeck results* ao lado dos seus
arquivos. O modo simples esconde, não protege: quem está no modo completo faz tudo o que o host
permite.

**Trocar de modo.** No modo completo, abra a página de um host e use o painel *Modo simples*. As
primeiras linhas dizem em que modo o host abre e se está travado. *Modo padrão* (*App completo* ou
*Modo simples*) define o que a próxima pessoa vê; *Usar o modo simples neste host* é uma escolha
sua, guardada neste app. A chave *Travar este host no modo atual* tira a escolha de todos (ela
pergunta antes); um host travado fica no modo dele. Cada mudança mostra uma mensagem, e a linha do
host na barra lateral ganha uma etiqueta *Simples* quando ele abre no modo simples e um cadeado
quando está travado.

**Sair do modo simples.** Toda tela simples termina o menu com *App completo* (pergunta uma vez). Num
host travado, o menu diz para pedir a quem administra que libere. **Ctrl+Shift+M**, a paleta
(*Mudar para o app completo*) e, no app completo, *Modo simples* no rodapé da barra lateral também
trocam o modo, mantendo as suas abas.

**Suas próprias tarefas.** Um host pode ter tarefas como arquivos Markdown na pasta `templates/` dos
dados do daemon: um cabeçalho com título, ícone, campos, predefinição e se começa planejando, e uma
seção de instrução por idioma (`# en`, `# pt-BR`). Um arquivo com problema é ignorado e a checagem
de saúde do host (*doctor*) o lista.
