# Flightdeck — Spec da Fase 24 (Ambiente de execução por card)

## Objetivo

Com várias worktrees em paralelo, rodar o app de dois cards ao mesmo tempo quebra por causa das portas. A fase dá a cada card **scripts de preparo e de execução, um bloco de portas próprio e um preview** do app rodando. É a metade de "executar e ver" que falta ao `.worktreeinclude` da Fase 11.

Origem: pesquisa de 30/10/2026. O Conductor reserva um bloco de 10 portas por workspace e tem o botão Run; o Emdash copia o `.env` e tem preview. Pré-requisitos: Fases 4, 11 e 14 (terminal e abas).

## Desenho

- **Configuração do projeto,** em `.flightdeck/run.yaml` versionado, com confiança pelo hash como os workflows:
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
  ```
- **Portas:**
  - cada card ganha um bloco de 10 portas livres a partir de `run.portBase`, com padrão 41000;
  - a reserva é por card e vale até ele ser concluído;
  - `{{port.<nome>}}` vira a porta dentro do bloco, e a variável `FLIGHTDECK_PORT_<NOME>` também vai no ambiente.
- **Execução:**
  - "Run" no card roda o `setup`, se ainda não rodou, e depois cada `run` como processo filho;
  - cada processo aparece numa aba de terminal da Fase 14, com o PTY real;
  - "Stop" encerra a árvore de processos inteira (no Windows, pelo job object ou por `taskkill /T`);
  - um modo "não concorrente" por projeto permite um card rodando de cada vez.
- **Preview:**
  - quando o `ready.http` responde, a aba "Preview" abre a URL num webview do app, só para `127.0.0.1` e `localhost`;
  - um botão abre no navegador do sistema.
- **Segurança:** os comandos vêm só do `run.yaml` confiado, sem shell, e o cwd é a worktree do card.

## Testes e critérios

| Área | O que precisa passar |
| --- | --- |
| `run-config` | schema; confiança pelo hash; comando fora do arquivo recusado |
| `portas` | bloco por card sem colisão; liberado ao concluir; variáveis no ambiente |
| `run-execucao` | setup uma vez; processos em abas; stop encerra a árvore; modo não concorrente |
| `preview` | só loopback; espera o `ready`; abrir no navegador |
| `run-ui` | Run e Stop no card; estado dos processos; abas de log e de preview |

**Smoke (`smoke:run`):** dois cards rodam um servidor de eco em portas diferentes ao mesmo tempo, os dois respondem, e o stop encerra tudo.

**Critérios de aceite:** os de sempre e a versão `0.24.0`.
