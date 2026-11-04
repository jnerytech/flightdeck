# language: pt
@roi-headline
Funcionalidade: Entregamos mais?
  A página do projeto começa pelo que foi entregue, contra o período anterior.

  Cenário: A página do projeto diz que entregou mais que o período anterior
    Dado que o projeto da demo concluiu mais cards neste mês que no período anterior
    Quando abro o board do projeto da demo
    Então o cartão de retorno sobre o custo diz que entregou mais que o período anterior
