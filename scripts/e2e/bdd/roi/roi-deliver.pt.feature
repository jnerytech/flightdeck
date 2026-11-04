# language: pt
Funcionalidade: Entregamos mais?

  Cenário: A página do projeto começa pelo que foi entregue contra o custo
    Dado que "shop" entregou 5 cards planejados e 2 não planejados este mês por 28,00 dólares
    E que "shop" entregou 4 cards planejados no mês passado por 31,00 dólares
    Quando abro o projeto "shop"
    Então a primeira linha diz "Entregamos 7 (5 planejados, 2 não planejados) por 28,00"
    E diz "mais que no mês passado, com um custo por item menor"

  Cenário: Entregar praticamente o mesmo é dito com clareza
    Dado que "shop" entregou 10 cards este mês e 10 cards no mês passado
    Quando abro o projeto "shop"
    Então a primeira linha diz "praticamente o mesmo que no mês passado"

  Cenário: Sem entrega, o custo ainda aparece
    Dado que "shop" não entregou nenhum card este mês e seus agentes custaram 6,00 dólares
    Quando abro o projeto "shop"
    Então a primeira linha diz "Nada entregue este mês" e mostra o custo 6,00
