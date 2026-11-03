# language: pt
@approval-with-a
Funcionalidade: Aprovação
  Uma sessão que quer rodar um comando espera a resposta da pessoa.

  Cenário: Aprovar um pedido com a tecla A
    Dado que uma sessão chamada "Aprovação do BDD" em "alfa" espera eu aprovar um comando
    Quando abro a fila do que precisa de mim
    E abro o pedido de "Aprovação do BDD"
    E aperto a tecla "a" no pedido
    Então o pedido de "Aprovação do BDD" sai da fila
