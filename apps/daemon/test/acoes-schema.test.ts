import { describe, expect, test } from "bun:test";
import {
  type ActionDef,
  approvalOf,
  parseActions,
  secretsOf,
  validateAction,
} from "../src/actions/schema.ts";

const SPEC_EXAMPLE = `
- name: deploy-staging
  description: Faz o deploy da branch na VPS de staging
  host: vps
  run: ["./scripts/deploy.sh", "{{param.branch}}"]
  cwd: /srv/app
  env:
    DEPLOY_TOKEN: "{{secret.deploy-token-staging}}"
  params:
    branch: { pattern: "^[a-zA-Z0-9._/-]{1,80}$", default: main }
  timeoutS: 600
- name: logs-prod
  description: Últimas linhas do log da API em produção
  ssh: prod-api
  run: ["journalctl", "-u", "api", "-n", "{{param.lines}}", "--no-pager"]
  params:
    lines: { pattern: "^[0-9]{1,4}$", default: "200" }
`;

/** One action with `over` on top of a valid base. */
const action = (over: Record<string, unknown> = {}) => ({
  name: "acao",
  description: "uma ação",
  run: ["./fazer.sh"],
  ...over,
});
const errorsOf = (raw: unknown, secretIds?: string[]) =>
  validateAction(raw, secretIds ? { secretIds: new Set(secretIds) } : {}).errors;

describe("acoes-schema", () => {
  test("o YAML do exemplo da spec carrega, com os padrões e a aprovação derivada", () => {
    const { actions, errors } = parseActions(SPEC_EXAMPLE);
    expect(errors).toEqual([]);
    expect(actions.map((a) => a.name)).toEqual(["deploy-staging", "logs-prod"]);
    const [deploy, logs] = actions as [ActionDef, ActionDef];
    expect(deploy).toMatchObject({
      host: "vps",
      cwd: "/srv/app",
      run: ["./scripts/deploy.sh", "{{param.branch}}"],
      env: { DEPLOY_TOKEN: "{{secret.deploy-token-staging}}" },
      params: { branch: { pattern: "^[a-zA-Z0-9._/-]{1,80}$", default: "main" } },
      timeoutS: 600,
    });
    expect(logs).toMatchObject({ ssh: "prod-api", env: {}, timeoutS: 120 });
    // With a secret the first use of a session asks; without one nothing does.
    expect(approvalOf(deploy)).toBe("first-per-session");
    expect(approvalOf(logs)).toBe("never");
    expect(approvalOf({ ...deploy, approval: "always" })).toBe("always");
    expect(secretsOf(deploy)).toEqual({ values: ["deploy-token-staging"], files: [] });
  });

  test("um arquivo vazio não tem ações; o que não é uma lista, ou não é YAML, é erro", () => {
    expect(parseActions("")).toEqual({ actions: [], errors: [] });
    expect(parseActions("# só um comentário\n").actions).toEqual([]);
    expect(parseActions("name: solto\n").errors.join()).toContain("lista");
    expect(parseActions("- name: [sem fechar\n").errors.join()).toContain("YAML");
  });

  test("run tem de ser uma lista de textos, não vazia", () => {
    for (const run of ["./fazer.sh --tudo", [], [1, 2], ["ok", null], undefined, { a: 1 }]) {
      const errors = errorsOf(action({ run }));
      expect([run, errors.length > 0 && errors.join().includes("run")]).toEqual([run, true]);
    }
  });

  test("segredo em argumento é erro (aparece na lista de processos); em env e no arquivo temporário não", () => {
    expect(errorsOf(action({ run: ["./fazer.sh", "{{secret.token}}"] })).join()).toContain(
      "argumento",
    );
    expect(errorsOf(action({ run: ["{{secret.token}}"] })).join()).toContain("argumento");
    expect(errorsOf(action({ run: ["./fazer.sh", "--token={{secret.token}}"] })).length).toBe(1);
    expect(errorsOf(action({ cwd: "/srv/{{secret.token}}" })).join()).toContain("cwd");
    expect(errorsOf(action({ env: { TOKEN: "{{secret.token}}" } }))).toEqual([]);
    // The path of the temporary file is not the secret.
    expect(errorsOf(action({ run: ["ssh", "-i", "{{secretFile.chave}}", "host"] }))).toEqual([]);
    expect(errorsOf(action({ env: { KEY_FILE: "{{secretFile.chave}}" } }))).toEqual([]);
    const ok = validateAction(
      action({ env: { A: "{{secret.a}}", B: "{{secretFile.b}}" }, run: ["x", "{{secretFile.c}}"] }),
    ).action as ActionDef;
    expect(secretsOf(ok)).toEqual({ values: ["a"], files: ["b", "c"] });
  });

  test("parâmetro sem pattern, com regex inválida ou com default fora do pattern é erro; usar um não declarado também", () => {
    const withParam = (param: unknown, run = ["./fazer.sh", "{{param.x}}"]) =>
      errorsOf(action({ run, params: { x: param } }));
    expect(withParam({})).not.toEqual([]);
    expect(withParam({ default: "a" }).join()).toContain("pattern");
    expect(withParam({ pattern: "([" }).join()).toContain("regex");
    expect(withParam({ pattern: "^[0-9]+$", default: "abc" }).join()).toContain("default");
    expect(withParam({ pattern: "^[0-9]+$", default: "123" })).toEqual([]);
    expect(withParam({ pattern: 5 })).not.toEqual([]);
    expect(errorsOf(action({ run: ["./fazer.sh", "{{param.y}}"] })).join()).toContain("y");
    // Declared and not used is fine.
    expect(errorsOf(action({ params: { x: { pattern: "^a$" } } }))).toEqual([]);
  });

  test("referência a segredo inexistente é erro, quando o app diz quais existem", () => {
    const env = { T: "{{secret.deploy-token}}", F: "{{secretFile.chave}}" };
    expect(errorsOf(action({ env }), ["deploy-token", "chave"])).toEqual([]);
    const errors = errorsOf(action({ env }), ["deploy-token"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("chave");
    // Without the app's list there is nothing to check against.
    expect(errorsOf(action({ env }))).toEqual([]);
  });

  test("{{param}} na posição de código de um interpretador é erro, e fora dela não", () => {
    const code = (run: string[]) =>
      errorsOf(action({ run, params: { x: { pattern: "^[a-z]+$" } } })).join();
    for (const run of [
      ["sh", "-c", "echo {{param.x}}"],
      ["node", "-e", "{{param.x}}"],
      ["cmd", "/c", "dir {{param.x}}"],
      ["cmd", "/c", "dir", "{{param.x}}"],
      ["powershell", "-Command", "Get-Item {{param.x}}"],
      ["powershell", "-command", "Get-Item", "{{param.x}}"],
      ["pwsh", "-EncodedCommand", "{{param.x}}"],
      ["pwsh", "-encodedcommand", "{{param.x}}"],
      ["eval", "{{param.x}}"],
      ["bash", "-c", "{{param.x}}"],
    ]) {
      expect([run, code(run).includes("código")]).toEqual([run, true]);
    }
    // After the code: the idiom that passes a value as $1.
    expect(code(["sh", "-c", 'echo "$1"', "_", "{{param.x}}"])).toBe("");
    expect(code(["./fazer.sh", "{{param.x}}"])).toBe("");
    // The program itself is not a parameter either.
    expect(code(["{{param.x}}", "--ok"]).includes("executável")).toBe(true);
  });

  test("nome inválido ou repetido, campo desconhecido e timeout fora dos limites são erros", () => {
    expect(errorsOf(action({ name: "Com Espaço" })).join()).toContain("name");
    expect(errorsOf(action({ name: "" })).join()).toContain("name");
    expect(errorsOf(action({ description: undefined })).join()).toContain("description");
    expect(errorsOf(action({ segredos: ["a"] })).join()).toContain("segredos");
    expect(errorsOf(action({ timeoutS: 0 })).join()).toContain("timeoutS");
    expect(errorsOf(action({ timeoutS: 99_999 })).join()).toContain("timeoutS");
    expect(errorsOf(action({ approval: "talvez" })).join()).toContain("approval");
    expect(errorsOf(action({ env: { N: 5 } })).join()).toContain("env");
    expect(errorsOf(action({ env: { "COM ESPAÇO": "x" } })).join()).toContain("env");
    expect(errorsOf("texto")).not.toEqual([]);
    const twice = parseActions(
      `- { name: a, description: d, run: [x] }\n- { name: a, description: d, run: [y] }\n`,
    );
    expect(twice.errors.join()).toContain("repetid");
    // Valid ones still come back; the invalid one does not.
    const mixed = parseActions(
      `- { name: a, description: d, run: [x] }\n- { name: b, description: d, run: x }\n`,
    );
    expect(mixed.actions.map((a) => a.name)).toEqual(["a"]);
    expect(mixed.errors).toHaveLength(1);
  });
});
