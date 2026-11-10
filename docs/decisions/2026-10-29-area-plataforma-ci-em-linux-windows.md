# Área "plataforma" (CI em Linux e Windows) (issue #1711, moved from DECISIONS.md)

A primeira execução da CI no GitHub falhou nas duas pernas. Estas são as causas e o que mudou.

- **TEMP 8.3 no runner Windows:** o `TEMP` vem como `C:\Users\RUNNER~1\...`. O daemon resolve caminhos com `realpathSync.native`, que expande o nome curto; o `realpathSync` em JS não expande.
  - Os testes, as fixtures e os smokes passaram a criar pastas temporárias com `realTempDir` (`scripts/test/temp-dir.ts`), que usa a versão nativa.
  - No produto, o `resolveAllowedCwd` já normalizava os dois lados. O `update` passou a comparar com `realpathSync.native` o executável do serviço com o do processo e o do serviço com o caminho estável.
  - O teste de `~` da config confere a expansão exata, em vez de exigir que o caminho não tenha nenhum `~`.
  - Um `~` fora do começo do caminho nunca é tratado como home.
- **Home no Linux:** o `os.homedir()` do Bun, no Linux, guarda o `HOME` do início do processo. O Node e o Bun no Windows releem o ambiente a cada chamada.
  - `userHome()` lê `HOME` (no Windows, `USERPROFILE`) a cada chamada, com `os.homedir()` só como último recurso. O `expandHome`, a config padrão e o contexto do serviço usam essa função.
  - A trava de home confere o que o daemon usa.
- **happy-dom e os testes do daemon:** no Linux, o Bun roda os arquivos do desktop antes dos do daemon, no mesmo processo.
  - O happy-dom troca `AbortController`, `AbortSignal`, `Blob`, `URL` e os streams.
  - Os testes do daemon que vinham depois passavam objetos do happy-dom ao `fetch` e ao `spawn` do Bun, e falhavam assim:
    - `waitHealthy` sempre falso;
    - `hook session-start` sem entregar.
  - O `dom.ts` passou a manter as versões do Bun desses objetos.
- **Relógio:** num container, o relógio do sistema voltou no meio de um turno do `FakeRuntime`. O `durationMs` saiu negativo e reprovou no schema. A duração agora usa `performance.now()`.
- **`isServiceController`:** separa o comando por `/` e `\` em qualquer sistema. No Linux, o `basename` posix mantinha `C:\...\schtasks.exe` inteiro.
- **Cobertura nas duas pernas:** os ramos específicos de sistema recebem a dependência por parâmetro, para rodar nos dois sistemas.
  - O ramo do PowerShell no `processPath` recebe o executor.
  - O ramo de `/proc` recebe o `readlink`.
- **Reprodução local:**
  - Windows: a suíte com `TEMP`/`TMP` num caminho 8.3 (`%TEMP%\FL117F~1`);
  - Linux: o mesmo job num container `oven/bun:1.4.4`, a partir de um clone limpo.
- **CI:** a perna ubuntu voltou a bloquear (sem `continue-on-error`).
