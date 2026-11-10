# Ambiente de execução

[Voltar ao manual](../pt-BR.md) · [English](../en/run-environment.md)

Com várias worktrees ao mesmo tempo, rodar o app de dois cards quebra por causa das portas. O
ambiente de execução dá a cada card **scripts** para prepará-lo e rodá-lo, **um bloco de portas
próprio** e um **preview** do app rodando. Ele completa o `.worktreeinclude` (que traz os
arquivos) com a metade que executa. Precisa de um host com os terminais ligados (veja
[Abas e terminal embutido](tabs-and-embedded-terminal.md#abas-e-terminal-embutido)), porque cada processo abre numa aba.

## O run.yaml

O projeto o declara em `.flightdeck/run.yaml`, commitado no ramo-base (o arquivo da worktree de um
card nunca é lido: um agente poderia escrevê-lo).

```yaml
setup: ["bun", "install"]
run:
  - name: web
    cmd: ["bun", "run", "dev", "--port", "{{port.web}}"]
    ready: { http: "http://127.0.0.1:{{port.web}}/" }
  - name: api
    cmd: ["bun", "run", "api"]
    env: { PORT: "{{port.api}}" }
ports: [web, api]
exclusive: false
```

- Os comandos são **listas** (argv), nunca um texto para um shell: um texto simples é um erro. Eles
  rodam na worktree do card.
- `setup` roda uma vez por card, antes do primeiro Run. `run` lista os processos.
- `ports` dá os nomes das portas do bloco do card, em ordem. `{{port.<nome>}}` vira a porta num
  comando, numa variável ou no endereço do ready, e `FLIGHTDECK_PORT_<NOME>` (maiúsculas, `-` como
  `_`) vai no ambiente de todo processo.
- `ready.http` é o endereço que avisa ao app que o processo responde. Precisa ser http(s) em
  `127.0.0.1` ou `localhost`, sem usuário nem senha.
- `exclusive: true` é o **modo não concorrente** do projeto: um card roda de cada vez, e um segundo
  Run é recusado até o primeiro parar.

## Confiança

Nada do que o arquivo declara roda antes de você confiar nele. O painel **Ambiente de execução** do
card lista os comandos; **Confiar neste run.yaml** pergunta e confia naquele conteúdo exato (o
hash). Quando o arquivo muda no ramo-base, a confiança some até você revisar de novo. Um arquivo com
erros mostra os erros e não oferece Confiar nem Run.

## Portas

Cada card guarda um bloco de 10 portas livres a partir de `run.portBase` da config do daemon (41000
por padrão; entre 1024 e 65526). Os blocos saem em ordem, nunca dois cards num só, e um bloco com
uma porta em uso na máquina é pulado. O bloco é do card até ele ser concluído, mesmo entre Runs, e
sobrevive a reiniciar o daemon.

## Run e Stop

Num card com worktree, **Run** roda o setup (se ainda não rodou) e depois cada processo, cada um
numa aba de terminal do host. O painel mostra o estado (setup, rodando, encerrado, falhou), as
portas e, em cada processo, o estado e **Ver log**, que abre a aba dele. Um setup que falha mostra o
código de saída e o Run o tenta de novo. **Stop** encerra a árvore inteira de cada processo, filhos
que ignoram sinais inclusive (o grupo de processos no Linux, `taskkill /T` no Windows). O card que
chega a done para sozinho e devolve as portas.

## Preview

Quando o `ready.http` de um processo responde (qualquer resposta HTTP conta, até um 404), a linha
dele ganha **Abrir preview**, que abre uma aba **Preview** com o app num quadro. O preview só abre
`127.0.0.1` e `localhost` (o endereço é conferido no daemon, no app e pela CSP do app, cujo
`frame-src` só deixa esses), não é guardado entre aberturas, e **Abrir no navegador** manda o mesmo
endereço para o navegador do sistema. Se o processo não responde em um minuto, a linha diz.
