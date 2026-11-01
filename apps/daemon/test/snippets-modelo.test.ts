import { describe, expect, test } from "bun:test";
import { fieldsOf, normalizeSnippet, renderSnippet, SecretScanner } from "../src/snippets/model.ts";

const scanner = new SecretScanner();

/** The error code of a call that is expected to fail. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
}

const command = (run: string, extra: Record<string, unknown> = {}) => ({
  name: "teste",
  type: "command" as const,
  run,
  ...extra,
});
const prompt = (text: string, extra: Record<string, unknown> = {}) => ({
  name: "revisar",
  type: "prompt" as const,
  text,
  ...extra,
});

describe("snippets-modelo: os dois tipos", () => {
  test("command leva run e prompt leva text; o outro campo, vazio ou o tipo trocado, é recusado", () => {
    expect(normalizeSnippet(command("bun test"), scanner)).toMatchObject({
      type: "command",
      run: "bun test",
      text: null,
      vars: {},
      tags: [],
    });
    expect(normalizeSnippet(prompt("Revise {{file}}."), scanner)).toMatchObject({
      type: "prompt",
      text: "Revise {{file}}.",
      run: null,
    });
    expect(codeOf(() => normalizeSnippet({ name: "x", type: "command" }, scanner))).toBe(
      "bad_request",
    );
    expect(codeOf(() => normalizeSnippet({ name: "x", type: "prompt" }, scanner))).toBe(
      "bad_request",
    );
    expect(codeOf(() => normalizeSnippet(command("ls", { text: "x" }), scanner))).toBe(
      "bad_request",
    );
    expect(codeOf(() => normalizeSnippet(prompt("oi", { run: "ls" }), scanner))).toBe(
      "bad_request",
    );
    expect(codeOf(() => normalizeSnippet(command("x".repeat(4001)), scanner))).toBe("bad_request");
    expect(codeOf(() => normalizeSnippet(prompt("x".repeat(20_001)), scanner))).toBe("bad_request");
  });

  test("o nome é de 1 a 64 caracteres simples", () => {
    for (const name of ["", " ", "-x", "a/b", "a\nb", "x".repeat(65)]) {
      expect([name, codeOf(() => normalizeSnippet(command("ls", { name }), scanner))]).toEqual([
        name,
        "bad_request",
      ]);
    }
    expect(normalizeSnippet(command("ls", { name: "  testes rápidos.v2  " }), scanner).name).toBe(
      "testes rápidos.v2",
    );
  });

  test("um comando é uma linha só e nenhum texto leva caracteres de controle: colar não pode executar o que o usuário não viu", () => {
    for (const run of ["ls\nrm -rf x", "ls\r", "ls\u001b[201~rm", "ls\u0000", "ls\u007f"]) {
      expect([JSON.stringify(run), codeOf(() => normalizeSnippet(command(run), scanner))]).toEqual([
        JSON.stringify(run),
        "bad_request",
      ]);
    }
    // A tab is fine in a command; a prompt may have lines but still no escapes.
    expect(codeOf(() => normalizeSnippet(command("echo\tok"), scanner))).toBe("ok");
    expect(codeOf(() => normalizeSnippet(prompt("linha 1\nlinha 2\r\n\tfim"), scanner))).toBe("ok");
    expect(codeOf(() => normalizeSnippet(prompt("oi\u001b[2J"), scanner))).toBe("bad_request");
  });

  test("as tags são aparadas, sem repetição, com limite e sem vírgula nem controle", () => {
    expect(
      normalizeSnippet(command("ls", { tags: [" git ", "git", "", "ops"] }), scanner).tags,
    ).toEqual(["git", "ops"]);
    for (const tags of [
      ["a,b"],
      ["a\nb"],
      ["x".repeat(31)],
      Array.from({ length: 11 }, (_, i) => `t${i}`),
    ]) {
      expect(codeOf(() => normalizeSnippet(command("ls", { tags }), scanner))).toBe("bad_request");
    }
  });
});

describe("snippets-modelo: variáveis", () => {
  test("{{nome}} vira um campo, com valor padrão e opções, na ordem em que aparece e sem repetir", () => {
    const def = normalizeSnippet(
      command("deploy {{ env }} {{arquivo}} {{env}} {{cwd}}", {
        vars: {
          env: { default: "staging", options: ["staging", "prod"] },
          arquivo: { default: "" },
        },
      }),
      scanner,
    );
    expect(fieldsOf(def)).toEqual([
      { name: "env", special: false, default: "staging", options: ["staging", "prod"] },
      { name: "arquivo", special: false, default: "", options: [] },
      { name: "cwd", special: true, default: null, options: [] },
    ]);
    // A placeholder with no declaration is a field with no default.
    expect(fieldsOf(normalizeSnippet(command("echo {{msg}}"), scanner))).toEqual([
      { name: "msg", special: false, default: null, options: [] },
    ]);
    expect(fieldsOf(normalizeSnippet(command("ls"), scanner))).toEqual([]);
  });

  test("as especiais cwd, branch, file e selection são do contexto e não podem ser declaradas", () => {
    const def = normalizeSnippet(
      prompt("{{file}} em {{branch}} ({{cwd}}): {{selection}}"),
      scanner,
    );
    expect(fieldsOf(def).map((f) => [f.name, f.special])).toEqual([
      ["file", true],
      ["branch", true],
      ["cwd", true],
      ["selection", true],
    ]);
    for (const special of ["cwd", "branch", "file", "selection"]) {
      expect(
        codeOf(() =>
          normalizeSnippet(command(`echo {{${special}}}`, { vars: { [special]: {} } }), scanner),
        ),
      ).toBe("bad_request");
    }
  });

  test("a declaração precisa servir: nome válido, usado no texto, padrão entre as opções, opções sem repetir", () => {
    const bad = (vars: Record<string, unknown>, run = "echo {{a}}") =>
      codeOf(() => normalizeSnippet(command(run, { vars }), scanner));
    expect(bad({ "1a": {} }, "echo {{1a}}")).toBe("bad_request");
    expect(bad({ a: {}, b: {} })).toBe("bad_request");
    expect(bad({ a: { default: "x", options: ["y", "z"] } })).toBe("bad_request");
    expect(bad({ a: { options: ["y", "y"] } })).toBe("bad_request");
    expect(bad({ a: { options: [""] } })).toBe("bad_request");
    expect(bad({ a: { options: Array.from({ length: 51 }, (_, i) => `o${i}`) } })).toBe(
      "bad_request",
    );
    expect(bad({ a: { default: "a\nb" } })).toBe("bad_request");
    expect(bad({ a: { default: "x", options: ["x", "y"] } })).toBe("ok");
  });

  test("renderizar troca cada campo: o valor dado, senão o padrão, e as especiais vêm do contexto", () => {
    const def = normalizeSnippet(
      command("git -C {{cwd}} checkout {{branch}} && bun test {{arquivo}} --env {{env}}", {
        vars: { arquivo: { default: "" }, env: { default: "dev", options: ["dev", "prod"] } },
      }),
      scanner,
    );
    const context = { cwd: "/work/app", branch: "main" };
    expect(renderSnippet(def, { arquivo: "a.test.ts" }, context)).toBe(
      "git -C /work/app checkout main && bun test a.test.ts --env dev",
    );
    expect(renderSnippet(def, { env: "prod" }, context)).toBe(
      "git -C /work/app checkout main && bun test  --env prod",
    );
    // The same field twice gets the same value; a value that looks like a placeholder is not expanded.
    const twice = normalizeSnippet(command("{{a}} {{a}}"), scanner);
    expect(renderSnippet(twice, { a: "{{cwd}}" }, context)).toBe("{{cwd}} {{cwd}}");
  });

  test("faltando valor ou contexto, ou fora das opções, a renderização é recusada dizendo o quê", () => {
    const def = normalizeSnippet(
      command("echo {{msg}} {{file}}", { vars: { msg: { options: ["a", "b"] } } }),
      scanner,
    );
    const failure = (values: Record<string, string>, context = {}) => {
      try {
        renderSnippet(def, values, context);
        return "ok";
      } catch (error) {
        return `${(error as { code: string }).code}: ${(error as Error).message}`;
      }
    };
    expect(failure({}, {})).toMatch(/bad_request: missing values: msg, file/);
    expect(failure({ msg: "a" }, {})).toMatch(/missing values: file/);
    expect(failure({ msg: "c" }, { file: "x" })).toMatch(/bad_request: .*msg.*outside the options/);
    expect(failure({ msg: "a" }, { file: "x.ts" })).toBe("ok");
  });

  test("o valor de um comando não leva quebra de linha nem controle; o de um prompt pode ter linhas", () => {
    const cmd = normalizeSnippet(command("echo {{msg}}"), scanner);
    for (const value of ["a\nrm -rf x", "a\r", "a\u001b[201~", "a\u0000"]) {
      expect([JSON.stringify(value), codeOf(() => renderSnippet(cmd, { msg: value }, {}))]).toEqual(
        [JSON.stringify(value), "bad_request"],
      );
    }
    // A multi-line selection cannot go into a command either.
    const withSelection = normalizeSnippet(command("grep {{selection}} ."), scanner);
    expect(codeOf(() => renderSnippet(withSelection, {}, { selection: "um\ndois" }))).toBe(
      "bad_request",
    );
    const text = normalizeSnippet(prompt("Explique:\n{{selection}}"), scanner);
    expect(renderSnippet(text, {}, { selection: "linha 1\nlinha 2" })).toBe(
      "Explique:\nlinha 1\nlinha 2",
    );
    expect(codeOf(() => renderSnippet(text, {}, { selection: "x\u001b[2J" }))).toBe("bad_request");
  });
});

describe("snippets-modelo: segredos", () => {
  const found = (text: string) => scanner.scan(text);

  test("reconhece tokens, chaves privadas, senhas na linha e credenciais em URL, dizendo o tipo e nunca o valor", () => {
    const secret = (label: string, text: string) => {
      const labels = found(text);
      expect([label, labels.includes(label)]).toEqual([label, true]);
      // What was found is named, never repeated.
      expect(JSON.stringify(labels)).not.toContain("0123456789abcdef");
    };
    secret("token do GitHub", "curl -H 'X: ghp_0123456789abcdef0123456789abcdef0123'");
    secret(
      "token do GitHub",
      "git clone https://github_pat_0123456789abcdef0123456789abcdef@github.com/a/b",
    );
    secret("chave sk-", "export OPENAI_API_KEY=sk-proj-0123456789abcdef0123456789abcdef");
    secret("chave da AWS", "aws configure set key AKIA0123456789ABCDEF");
    secret("chave privada", "echo '-----BEGIN OPENSSH PRIVATE KEY-----'");
    secret("chave privada", "-----BEGIN RSA PRIVATE KEY-----");
    secret("token Bearer", 'curl -H "Authorization: Bearer abcdefghijklmnop0123456789"');
    secret("senha na linha", "mysql -u root password=hunter2hunter2");
    secret("senha na linha", "export TOKEN=0123456789abcdef");
    secret("senha na linha", "deploy --token=0123456789abcdef");
    secret("senha na linha", "curl 'https://api.example.com?api_key=0123456789abcdef'");
    secret("credencial em URL", "psql postgres://admin:s3cr3tpass@db.example.com/app");
    secret("token do Slack", "curl -d token=xoxb-0123456789-abcdefghij https://slack.com/api");
  });

  test("não confunde com texto comum nem com uma variável que vai receber o valor", () => {
    for (const text of [
      "bun test src/token.test.ts",
      "echo password",
      "ssh -i key.pem host",
      "git log --oneline -n 10",
      "export TOKEN={{token}}",
      "curl -H 'Authorization: Bearer {{token}}'",
      "psql postgres://{{user}}:{{pass}}@db/app",
      "echo sk-short",
      "Revise o código procurando segredos expostos e senhas fracas.",
      "password=",
    ]) {
      expect([text, found(text)]).toEqual([text, []]);
    }
  });

  test("os valores do cofre, quando houver, também valem: uma extensão que a Fase 16 preenche", () => {
    const vaulted = new SecretScanner(() => ["correct-horse-battery", "ab"]);
    expect(vaulted.scan("echo correct-horse-battery")).toEqual(["valor do cofre"]);
    // Too short to be told from ordinary text.
    expect(vaulted.scan("echo ab abc")).toEqual([]);
    expect(new SecretScanner().scan("echo correct-horse-battery")).toEqual([]);
  });

  test("um snippet com segredo é recusado com o código que faz o app oferecer Transformar em ação, em qualquer campo", () => {
    const token = "ghp_0123456789abcdef0123456789abcdef0123";
    const refused = (input: Record<string, unknown>) => {
      try {
        normalizeSnippet(input as never, scanner);
        return "ok";
      } catch (error) {
        const e = error as { code: string; message: string };
        return `${e.code}|${e.message.includes(token)}|${/token do GitHub/.test(e.message)}`;
      }
    };
    expect(refused(command(`gh auth login --with-token ${token}`))).toBe(
      "snippet_secret|false|true",
    );
    expect(refused(prompt(`Use o token ${token} para chamar a API`))).toBe(
      "snippet_secret|false|true",
    );
    expect(refused(command("echo {{a}}", { vars: { a: { default: token } } }))).toBe(
      "snippet_secret|false|true",
    );
    expect(refused(command("echo {{a}}", { vars: { a: { options: ["x", token] } } }))).toBe(
      "snippet_secret|false|true",
    );
    // The name and the tags are content too, and are looked at before anything else about them.
    expect(refused(command("ls", { tags: [token] }))).toBe("snippet_secret|false|true");
    expect(refused(command("ls", { name: token }))).toBe("snippet_secret|false|true");
    expect(refused(command("ls", { name: "ls" }))).toBe("ok");
  });
});

describe("snippets-modelo: a failure that is not the snippet's", () => {
  test("a scanner that breaks surfaces its own error, not a refusal of the snippet", () => {
    const broken = new SecretScanner();
    broken.scan = () => {
      throw new TypeError("the scanner broke");
    };
    let thrown: unknown;
    try {
      normalizeSnippet(command("bun test"), broken);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toBe("the scanner broke");
    expect((thrown as { code?: string }).code).toBeUndefined();
  });
});

/** What a refusal carries: the code, the stable reason the app translates, its params, the log text. */
function refusal(fn: () => unknown) {
  try {
    fn();
    return null;
  } catch (error) {
    const { code, reason, params, message } = error as {
      code: string;
      reason?: string;
      params?: Record<string, string | number>;
      message: string;
    };
    return { code, reason, params, message };
  }
}

describe("snippets-modelo: a refusal carries a reason the app translates", () => {
  const ok = { name: "a" };
  const cases: Array<[string, () => unknown, Record<string, string | number>]> = [
    ["name_invalid", () => normalizeSnippet(command("ls", { name: "x".repeat(65) }), scanner), {}],
    ["needs_run", () => normalizeSnippet(command(""), scanner), {}],
    ["needs_text", () => normalizeSnippet(prompt(""), scanner), {}],
    ["no_text", () => normalizeSnippet(command("ls", { text: "a" }), scanner), {}],
    ["no_run", () => normalizeSnippet(prompt("a", { run: "ls" }), scanner), {}],
    ["too_big", () => normalizeSnippet(command("x".repeat(4001)), scanner), {}],
    ["control_command", () => normalizeSnippet(command("ls\nrm"), scanner), {}],
    ["control_prompt", () => normalizeSnippet(prompt("a\u0001b"), scanner), {}],
    [
      "var_name",
      () => normalizeSnippet(command("echo {{a}}", { vars: { "1x": {} } }), scanner),
      { name: "1x" },
    ],
    [
      "var_special",
      () => normalizeSnippet(command("echo {{cwd}}", { vars: { cwd: {} } }), scanner),
      { name: "cwd" },
    ],
    [
      "var_unused",
      () => normalizeSnippet(command("ls", { vars: { a: {} } }), scanner),
      { name: "a" },
    ],
    [
      "too_many_tags",
      () =>
        normalizeSnippet(
          command("ls", { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }),
          scanner,
        ),
      { max: 10 },
    ],
    ["tag_invalid", () => normalizeSnippet(command("ls", { tags: ["a,b"] }), scanner), {}],
    [
      "too_many_options",
      () =>
        normalizeSnippet(
          command("echo {{a}}", {
            vars: { a: { options: Array.from({ length: 51 }, (_, i) => `o${i}`) } },
          }),
          scanner,
        ),
      { name: "a" },
    ],
    [
      "options_plain",
      () =>
        normalizeSnippet(command("echo {{a}}", { vars: { a: { options: ["x", "x"] } } }), scanner),
      { name: "a" },
    ],
    [
      "default_control",
      () =>
        normalizeSnippet(command("echo {{a}}", { vars: { a: { default: "a\u0001" } } }), scanner),
      { name: "a" },
    ],
    [
      "default_not_option",
      () =>
        normalizeSnippet(
          command("echo {{a}}", { vars: { a: { options: ["x"], default: "y" } } }),
          scanner,
        ),
      { name: "a" },
    ],
  ];

  for (const [reason, run, params] of cases) {
    test(`${reason}: the code stays bad_request, the reason and params are set, the message is English`, () => {
      const got = refusal(run);
      expect(got?.code).toBe("bad_request");
      expect(got?.reason).toBe(reason);
      expect(got?.params).toEqual(params);
      expect(got?.message).not.toMatch(/[À-ú]/);
    });
  }

  test("using a snippet: a value with a control character, outside the options, or missing, each has its reason", () => {
    const def = normalizeSnippet(
      command("echo {{a}} {{b}}", { vars: { b: { options: ["x", "y"] } } }),
      scanner,
    );
    expect(refusal(() => renderSnippet(def, { a: "1\n2", b: "x" }, {}))).toMatchObject({
      reason: "value_control",
      params: { name: "a" },
    });
    expect(refusal(() => renderSnippet(def, { a: "1", b: "z" }, {}))).toMatchObject({
      reason: "value_not_option",
      params: { name: "b", options: "x, y" },
    });
    expect(refusal(() => renderSnippet(def, {}, {}))).toMatchObject({
      reason: "missing_values",
      params: { names: "a, b" },
    });
  });

  test("a secret keeps snippet_secret and gets the reason secret", () => {
    const got = refusal(() =>
      normalizeSnippet(command("echo ghp_0123456789abcdef0123456789abcdef0123", ok), scanner),
    );
    expect(got?.code).toBe("snippet_secret");
    expect(got?.reason).toBe("secret");
  });
});
