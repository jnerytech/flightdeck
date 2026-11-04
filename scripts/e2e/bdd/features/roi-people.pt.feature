# language: pt
@roi-people
Funcionalidade: Orçamento de tokens por pessoa
  Uma pessoa agrupa hosts e tem um limite mensal; a tela de Custos lista as pessoas por nome.

  Cenário: Uma pessoa é criada com limite mensal de tokens e listada por nome
    Dado que estou na tela de Custos
    Quando adiciono a pessoa "Ana" no primeiro host com limite mensal de "5000000" tokens
    Então a tabela de pessoas lista "Ana" contra um limite de 5 milhões de tokens
