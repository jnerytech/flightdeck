# language: pt
Funcionalidade: Orçamento de tokens por pessoa contra a entrega

  Cenário: Uma pessoa vê os tokens usados contra o limite e o que foi entregue
    Dado que a pessoa "Ana" é dona do host "alfa" e tem um limite mensal de 5 milhões de tokens
    E que "alfa" usou 3,1 milhões de tokens e entregou 7 cards e 4 PRs este mês
    Quando abro a tabela de pessoas em Custos
    Então a linha de "Ana" mostra "62% de 5 milhões de tokens usados"
    E mostra "7 cards, 4 PRs" e "0,44 milhão de tokens por card"

  Cenário: A tabela de pessoas não é um ranking
    Dado que duas pessoas têm entregas diferentes
    Quando abro a tabela de pessoas
    Então as linhas estão em ordem de nome
    E a página diz que hosts não são pessoas e que os números são correlacionados
