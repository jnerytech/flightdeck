# language: pt
@new-session
Funcionalidade: Nova sessão
  Uma pessoa começa uma sessão num host pela tela Nova sessão.

  Cenário: Começar uma sessão com um primeiro prompt
    Dado que estou na tela de nova sessão do host "alfa"
    Quando escrevo o primeiro prompt "liste os arquivos"
    E crio a sessão
    Então a sessão abre mostrando o meu prompt "liste os arquivos"
