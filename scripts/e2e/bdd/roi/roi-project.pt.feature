# language: pt
Funcionalidade: Retorno sobre o custo por projeto

  Cenário: A página do projeto mostra o que os agentes custaram e entregaram
    Dado que o projeto "shop" teve 3 cards concluídos e 2 PRs mesclados este mês
    E que as sessões dos agentes em "shop" custaram 12,00 dólares este mês
    Quando abro o projeto "shop"
    Então o cartão de retorno mostra "3 cards concluídos" e "2 PRs mesclados"
    E mostra "custo por card 4,00" e "custo por PR 6,00"
    E ainda não aparece valor estimado nem retorno

  Cenário: Um valor da hora e as horas transformam o trabalho entregue em valor estimado
    Dado que o cliente "Acme" tem o valor da hora de 60 dólares
    E que o projeto "shop" pertence a "Acme" e estima 2 horas por card
    E que 3 cards de "shop" foram concluídos este mês e custaram 12,00 dólares
    Quando abro o projeto "shop"
    Então o cartão de retorno mostra "6 horas estimadas" marcadas como estimativa
    E mostra "valor estimado 360,00" e "retorno sobre o custo (estimativa) 29 vezes"
    E "Como isso é calculado?" lista as horas, o valor da hora e o custo usados

  Cenário: Sem valor da hora, os números de custo por unidade ainda aparecem
    Dado que nenhum valor da hora está definido para "shop" nem para o cliente dele
    Quando abro o projeto "shop"
    Então o cartão de retorno mostra "defina o valor da hora para ver o valor estimado"
    E o custo por card continua aparecendo

  Cenário: O retrabalho aparece ao lado da razão
    Dado que um PR de "shop" precisou de 2 rodadas de conserto que custaram 1,50 dólar
    Quando abro o projeto "shop"
    Então o cartão de retorno mostra uma linha de retrabalho com "2 rodadas de conserto" e "1,50"

  Cenário: Cards sem estimativa são contados, não escondidos
    Dado que 2 dos 3 cards concluídos de "shop" não têm horas e o projeto não tem padrão
    Quando abro o projeto "shop"
    Então as horas estimadas são as do 1 card que as tem
    E o cartão diz "2 cards sem estimativa"

  Cenário: O período é comparado com o anterior
    Dado que "shop" entregou 2 cards a 5,00 cada no mês passado e 3 cards a 4,00 cada este mês
    Quando abro o projeto "shop"
    Então o cartão de retorno mostra "custo por card 20% menor que no mês passado"

  Cenário: A tela de Custos ordena os projetos e os exporta
    Dado que os projetos "shop" e "blog" têm retornos diferentes este mês
    Quando abro Custos e ordeno a tabela de projetos por retorno sobre o custo
    Então o melhor projeto aparece primeiro
    E ao apertar "Exportar CSV" salva um arquivo com uma linha por projeto e o cálculo de cada número

  Cenário: Meu tempo de revisão só conta quando eu peço
    Dado que os pedidos de "shop" esperaram 3 horas no total por mim este mês
    Quando abro o projeto "shop"
    Então o cartão diz "pedidos esperaram 3 h por você" como informação e o custo não inclui isso
    Quando ligo "contar meu tempo de revisão" com um limite de 5 minutos
    Então o custo inclui no máximo 5 minutos por decisão

  Cenário: Um host offline não apaga o projeto
    Dado que "shop" tem trabalho em dois hosts e um deles está offline
    Quando abro o projeto "shop"
    Então os números do host online aparecem, e os do outro host ficam marcados "em" a última hora dele
