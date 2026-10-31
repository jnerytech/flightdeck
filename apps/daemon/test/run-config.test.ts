import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  declaredCommands,
  isDeclared,
  parseRunConfig,
  RUN_CONFIG_PATH,
  RunConfigs,
} from "../src/runenv/config.ts";
import { git, newBoard } from "./board-helpers.ts";

/** The example of docs/SPEC-fase-24.md. */
const EXAMPLE = `
setup: ["bun", "install"]
run:
  - name: web
    cmd: ["bun", "run", "dev", "--port", "{{port.web}}"]
    ready: { http: "http://127.0.0.1:{{port.web}}/" }
  - name: api
    cmd: ["bun", "run", "api"]
    env: { PORT: "{{port.api}}" }
ports: [web, api]
`;

const errorsOf = (source: string) => parseRunConfig(source).errors;

describe("run-config: o esquema", () => {
  test("o exemplo da spec carrega, com setup, processos, env, ready e portas", () => {
    const { config, errors } = parseRunConfig(EXAMPLE);
    expect(errors).toEqual([]);
    expect(config).toEqual({
      setup: ["bun", "install"],
      run: [
        {
          name: "web",
          cmd: ["bun", "run", "dev", "--port", "{{port.web}}"],
          env: {},
          ready: { http: "http://127.0.0.1:{{port.web}}/" },
        },
        { name: "api", cmd: ["bun", "run", "api"], env: { PORT: "{{port.api}}" }, ready: null },
      ],
      ports: ["web", "api"],
    });
  });

  test("sem setup nem portas, só com um processo, também carrega", () => {
    const { config } = parseRunConfig('run:\n  - name: app\n    cmd: ["./app"]\n');
    expect(config).toEqual({
      setup: null,
      run: [{ name: "app", cmd: ["./app"], env: {}, ready: null }],
      ports: [],
    });
  });

  test("YAML quebrado e campo desconhecido são erros, e a configuração fica nula", () => {
    expect(errorsOf("run: [")[0] ?? "").toContain("YAML inválido");
    expect(parseRunConfig("run: [").config).toBeNull();
    expect(errorsOf('run:\n  - name: a\n    cmd: ["x"]\nshell: true\n')).toEqual([
      "(raiz): campo desconhecido: shell",
    ]);
  });

  test("tipos errados dizem o que faltou: run que não é lista, processo que não é objeto", () => {
    expect(errorsOf("run: 5\n")).toEqual(["run: tipo inválido"]);
    expect(errorsOf("run:\n  - 3\n")).toEqual(["run.0: precisa ser um objeto"]);
  });

  test("o comando é uma lista de textos: um texto só (que iria a um shell) é recusado", () => {
    expect(errorsOf('run:\n  - name: a\n    cmd: "bun run dev"\n')).toEqual([
      "run.0.cmd: precisa ser uma lista de textos",
    ]);
    expect(errorsOf('setup: "bun install"\nrun:\n  - name: a\n    cmd: ["x"]\n')).toEqual([
      "setup: precisa ser uma lista de textos",
    ]);
    expect(errorsOf("run:\n  - name: a\n    cmd: []\n")).toEqual([
      "run.0.cmd: precisa de ao menos um item",
    ]);
  });

  test("precisa de ao menos um processo, de nomes únicos e simples", () => {
    expect(errorsOf("run: []\n")).toEqual(["run: precisa de ao menos um item"]);
    expect(errorsOf("ports: [a]\n")).toEqual(["run: obrigatório"]);
    expect(errorsOf('run:\n  - { name: a, cmd: ["x"] }\n  - { name: a, cmd: ["y"] }\n')).toEqual([
      "run.1: nome repetido: a",
    ]);
    expect(errorsOf('run:\n  - { name: "a b", cmd: ["x"] }\n')).toEqual([
      "run.0.name: nome inválido",
    ]);
  });

  test("as portas: nomes simples e únicos, no máximo as 10 de um bloco", () => {
    const run = 'run:\n  - { name: a, cmd: ["x"] }\n';
    expect(errorsOf(`${run}ports: [web, web]\n`)).toEqual(["ports.1: porta repetida: web"]);
    expect(errorsOf(`${run}ports: ["a b"]\n`)).toEqual(["ports.0: nome de porta inválido"]);
    const eleven = Array.from({ length: 11 }, (_, i) => `p${i}`).join(", ");
    expect(errorsOf(`${run}ports: [${eleven}]\n`)).toEqual(["ports: no máximo 10 portas por card"]);
  });

  test("{{port.nome}} só vale para uma porta declarada, e nenhuma outra {{…}} existe", () => {
    expect(errorsOf('run:\n  - { name: a, cmd: ["x", "{{port.web}}"] }\nports: [api]\n')).toEqual([
      "run.0.cmd.1: porta não declarada: web",
    ]);
    expect(errorsOf('run:\n  - { name: a, cmd: ["x"], env: { P: "{{port.nope}}" } }\n')).toEqual([
      "run.0.env.P: porta não declarada: nope",
    ]);
    expect(errorsOf('run:\n  - { name: a, cmd: ["x", "{{inputs.nome}}"] }\n')).toEqual([
      "run.0.cmd.1: referência desconhecida: {{inputs.nome}}",
    ]);
  });

  test("ready.http só pode apontar para 127.0.0.1 ou localhost, em http ou https", () => {
    const withReady = (url: string) =>
      `run:\n  - name: a\n    cmd: ["x"]\n    ready: { http: "${url}" }\n`;
    expect(errorsOf(withReady("http://127.0.0.1:3000/"))).toEqual([]);
    expect(errorsOf(withReady("https://localhost/"))).toEqual([]);
    expect(errorsOf(withReady("http://example.com/"))).toEqual([
      "run.0.ready.http: só 127.0.0.1 e localhost",
    ]);
    expect(errorsOf(withReady("ftp://127.0.0.1/"))).toEqual([
      "run.0.ready.http: precisa ser http ou https",
    ]);
    expect(errorsOf(withReady("não é url"))).toEqual(["run.0.ready.http: URL inválida"]);
  });
});

describe("run-config: comando fora do arquivo", () => {
  test("só os comandos do arquivo são declarados, como escritos, e qualquer outro é recusado", () => {
    const config = parseRunConfig(EXAMPLE).config ?? { setup: null, run: [], ports: [] };
    expect(parseRunConfig(EXAMPLE).config).not.toBeNull();
    expect(declaredCommands(config)).toEqual([
      ["bun", "install"],
      ["bun", "run", "dev", "--port", "{{port.web}}"],
      ["bun", "run", "api"],
    ]);
    expect(isDeclared(config, ["bun", "install"])).toBe(true);
    expect(isDeclared(config, ["bun", "run", "api"])).toBe(true);
    expect(isDeclared(config, ["rm", "-rf", "/"])).toBe(false);
    expect(isDeclared(config, ["bun", "install", "--evil"])).toBe(false);
    expect(isDeclared(config, [])).toBe(false);
  });
});

/** A project of a board over a repo, with `source` committed (or not) as the run file. */
async function projectWith(source?: string) {
  const ctx = newBoard();
  if (source !== undefined) commitRunFile(ctx.repo, source);
  const project = await ctx.board.addProject({ path: ctx.repo });
  return { ...ctx, project, configs: new RunConfigs({ db: ctx.store.db }) };
}

function commitRunFile(repo: string, source: string) {
  mkdirSync(join(repo, ".flightdeck"), { recursive: true });
  writeFileSync(join(repo, RUN_CONFIG_PATH), source);
  git(repo, "add", ".flightdeck");
  git(repo, "commit", "-q", "-m", "run.yaml");
}

const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

describe("run-config: confiança pelo hash", () => {
  test("sem arquivo no ramo-base, nada existe e nada pode ser confiado ou rodado", async () => {
    const { configs, project } = await projectWith();
    expect(await configs.info(project)).toEqual({
      exists: false,
      hash: null,
      trusted: false,
      errors: [],
      config: null,
    });
    await expect(configs.resolve(project)).rejects.toThrow("sem .flightdeck/run.yaml");
    await expect(configs.trust(project, "x")).rejects.toThrow("sem .flightdeck/run.yaml");
  });

  test("o arquivo existe, vale e ainda não é confiado: o hash vem, a execução é recusada", async () => {
    const { configs, project } = await projectWith(EXAMPLE);
    const info = await configs.info(project);
    expect(info.exists).toBe(true);
    expect(info.hash).toBe(sha256(EXAMPLE));
    expect(info.trusted).toBe(false);
    expect(info.errors).toEqual([]);
    expect(info.config?.ports).toEqual(["web", "api"]);
    await expect(configs.resolve(project)).rejects.toThrow("não confiado");
  });

  test("confiar no hash revisado libera a execução; um hash velho é recusado", async () => {
    const { configs, project } = await projectWith(EXAMPLE);
    await expect(configs.trust(project, "hash-velho")).rejects.toThrow("mudou");
    const trusted = await configs.trust(project, sha256(EXAMPLE));
    expect(trusted.trusted).toBe(true);
    expect((await configs.resolve(project)).run.map((p) => p.name)).toEqual(["web", "api"]);
  });

  test("o arquivo muda no ramo-base: a confiança some até um novo hash ser confiado", async () => {
    const { configs, project, repo } = await projectWith(EXAMPLE);
    await configs.trust(project, sha256(EXAMPLE));
    const changed = `${EXAMPLE}# outra versão\n`;
    commitRunFile(repo, changed);
    const info = await configs.info(project);
    expect(info.hash).toBe(sha256(changed));
    expect(info.trusted).toBe(false);
    await expect(configs.resolve(project)).rejects.toThrow("não confiado");
    await configs.trust(project, sha256(changed));
    expect((await configs.info(project)).trusted).toBe(true);
  });

  test("um arquivo com erros mostra os erros, não se confia nele e não roda", async () => {
    const { configs, project } = await projectWith('run:\n  - name: a\n    cmd: "x"\n');
    const info = await configs.info(project);
    expect(info.errors).toEqual(["run.0.cmd: precisa ser uma lista de textos"]);
    expect(info.config).toBeNull();
    await expect(configs.trust(project, info.hash ?? "")).rejects.toThrow("erros de validação");
    await expect(configs.resolve(project)).rejects.toThrow("erros de validação");
  });

  test("só vale o arquivo do ramo-base: um escrito na worktree do agente não é lido", async () => {
    const { configs, project, repo } = await projectWith();
    git(repo, "checkout", "-q", "-b", "feature");
    commitRunFile(repo, EXAMPLE);
    git(repo, "checkout", "-q", "main");
    expect((await configs.info(project)).exists).toBe(false);
  });
});
