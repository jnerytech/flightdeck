import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type RunOptions, resolveParams, runAction } from "../src/actions/run.ts";
import { type ActionDef, validateAction } from "../src/actions/schema.ts";
import { tempDir } from "./helpers.ts";

const BUN = process.execPath;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const TOKEN = "ghp_SEGREDO-DO-TESTE-55aa";
const KEY = "-----BEGIN KEY-----\nlinha-um-da-chave\nlinha-dois-da-chave\n-----END KEY-----";

/** A valid action running a Bun one-liner with `rest` after the code. */
function make(code: string, over: Record<string, unknown> = {}, rest: string[] = []): ActionDef {
  const { action, errors } = validateAction({
    name: "teste",
    description: "uma ação de teste",
    run: [BUN, "-e", code, ...rest],
    ...over,
  });
  if (!action) throw new Error(errors.join("; "));
  return action;
}
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const opts = (over: Partial<RunOptions> = {}): RunOptions => ({
  base: tempDir(),
  baseEnv: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
  ...over,
});
const code = async (fn: () => unknown) => {
  try {
    await fn();
    return "ok";
  } catch (error) {
    return `${(error as { code?: string }).code}: ${(error as Error).message}`;
  }
};

describe("acoes-execucao", () => {
  test("o argv vai ao programa como está, sem shell: aspas, ; | $() e espaços não significam nada", async () => {
    const nasty = "a b; echo oops | y $(z) `w` \"q\" 'r' & > f";
    const action = make("console.log(JSON.stringify(process.argv.slice(1)))", {
      params: { msg: { pattern: "^.+$" } },
      run: [BUN, "-e", "console.log(JSON.stringify(process.argv.slice(1)))", "{{param.msg}}", "ok"],
    });
    const result = await runAction(action, { msg: nasty }, {}, opts());
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.output.trim())).toEqual([nasty, "ok"]);
  });

  test("o segredo só chega ao programa pelo env, e o argv e a saída mascarada não o têm", async () => {
    const action = make(
      [
        "const h = require('node:crypto').createHash('sha256').update(process.env.TOKEN).digest('hex');",
        "console.log('hash=' + h + ' argv=' + process.argv.join(' ') + ' valor=' + process.env.TOKEN);",
      ].join(""),
      { env: { TOKEN: "{{secret.deploy-token}}" } },
    );
    const result = await runAction(action, {}, { "deploy-token": TOKEN }, opts());
    expect(result.output).toContain(`hash=${sha(TOKEN)}`);
    expect(result.output).toContain("valor=•••(deploy-token)");
    expect(result.output).not.toContain(TOKEN);
    expect(result.exitCode).toBe(0);
  });

  test("o arquivo temporário do segredo existe durante a execução e é apagado depois, até se falhar", async () => {
    const show =
      "const fs=require('node:fs');const p=process.argv[1];console.log('path='+p);console.log('hash='+require('node:crypto').createHash('sha256').update(fs.readFileSync(p,'utf8')).digest('hex'));console.log('conteudo='+fs.readFileSync(p,'utf8'));";
    const ok = await runAction(
      make(show, {}, ["{{secretFile.chave}}"]),
      {},
      { chave: KEY },
      opts(),
    );
    const path = /path=(.*)/.exec(ok.output)?.[1]?.trim() ?? "";
    expect(ok.output).toContain(`hash=${sha(KEY)}`);
    expect(ok.output).not.toContain("linha-um-da-chave");
    expect(path).not.toBe("");
    expect(existsSync(path)).toBe(false);
    const failing = await runAction(
      make(`${show}process.exit(3)`, {}, ["{{secretFile.chave}}"]),
      {},
      { chave: KEY },
      opts(),
    );
    expect(failing.exitCode).toBe(3);
    expect(existsSync(/path=(.*)/.exec(failing.output)?.[1]?.trim() ?? "")).toBe(false);
    // The same through an env variable that holds the path.
    const viaEnv = await runAction(
      make("console.log('p='+process.env.KEY_FILE)", { env: { KEY_FILE: "{{secretFile.chave}}" } }),
      {},
      { chave: KEY },
      opts(),
    );
    expect(existsSync(/p=(.*)/.exec(viaEnv.output)?.[1]?.trim() ?? "?")).toBe(false);
  });

  test("em sistemas POSIX o arquivo do segredo só é legível pelo dono", async () => {
    if (process.platform === "win32") return;
    const result = await runAction(
      make("console.log(require('node:fs').statSync(process.argv[1]).mode & 0o777)", {}, [
        "{{secretFile.chave}}",
      ]),
      {},
      { chave: KEY },
      opts(),
    );
    expect(result.output.trim()).toBe(String(0o600));
  });

  test("parâmetro fora do pattern, faltando, desconhecido ou só casando em parte é recusado, e nada é executado", async () => {
    const marker = join(tempDir(), "rodou.txt");
    const action = make(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x')`, {
      params: {
        n: { pattern: "^[0-9]{1,4}$" },
        parcial: { pattern: "[a-z]+", default: "abc" },
        padrao: { pattern: "^[a-z]+$", default: "main" },
      },
      run: [
        BUN,
        "-e",
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x')`,
        "{{param.n}}",
        "{{param.parcial}}",
        "{{param.padrao}}",
      ],
    });
    const refused = (given: Record<string, string>) => code(() => resolveParams(action, given));
    expect(await refused({ n: "12a" })).toStartWith("bad_request:");
    expect(await refused({ n: "12\n" })).toStartWith("bad_request:");
    expect(await refused({ n: "12; rm -rf /" })).toStartWith("bad_request:");
    expect(await refused({})).toContain("n");
    expect(await refused({ n: "1", desconhecido: "x" })).toContain("desconhecido");
    // A pattern with no anchors still has to match the whole value.
    expect(await refused({ n: "1", parcial: "abc123" })).toStartWith("bad_request:");
    expect(resolveParams(action, { n: "42" })).toEqual({ n: "42", parcial: "abc", padrao: "main" });
    expect(resolveParams(action, { n: "42", padrao: "dev" }).padrao).toBe("dev");
    expect(existsSync(marker)).toBe(false);
  });

  test("passou do timeout, o programa é morto e o resultado diz isso", async () => {
    const marker = join(tempDir(), "depois.txt");
    const action = make(
      `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x'), 1500); setInterval(() => {}, 1000)`,
    );
    const started = Date.now();
    const result = await runAction(action, {}, {}, opts({ timeoutMs: 250 }));
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(1400);
    await Bun.sleep(1700);
    expect(existsSync(marker)).toBe(false);
  });

  test("a saída vai mascarada, com o stderr, e cortada em 32 KB sem deixar metade de um segredo", async () => {
    const secrets = { "deploy-token": TOKEN, chave: KEY };
    const action = make(
      [
        "const t = process.env.TOKEN, k = process.env.KEY;",
        "console.log('literal ' + t);",
        "console.log('b64 ' + Buffer.from(t).toString('base64'));",
        "console.log('hex ' + Buffer.from(t).toString('hex'));",
        "console.log('url ' + encodeURIComponent(t));",
        "console.log('chave\\n' + k);",
        "console.error('erro ' + t);",
        "console.log('x'.repeat(100000));",
        "console.log(t);",
      ].join("\n"),
      { env: { TOKEN: "{{secret.deploy-token}}", KEY: "{{secret.chave}}" } },
    );
    const result = await runAction(action, {}, secrets, opts());
    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(true);
    expect(result.output.length).toBeLessThanOrEqual(32 * 1024 + 100);
    for (const value of [
      TOKEN,
      Buffer.from(TOKEN).toString("base64"),
      "linha-um-da-chave",
      "linha-dois-da-chave",
    ]) {
      expect(result.output).not.toContain(value);
    }
    expect(result.output).toContain("literal •••(deploy-token)");
    expect(result.output).toContain("erro •••(deploy-token)");
    expect(result.output).toContain("•••(chave)");
  });

  test("uma saída de centenas de KB é lida até o limite e o resto descartado, sem travar o programa nem deixar parte do segredo", async () => {
    const action = make(
      [
        "const t = process.env.TOKEN;",
        // The capture stops at 250,000 characters: the secret starts ten characters before that.
        "process.stdout.write('y'.repeat(250_000 - 10));",
        "process.stdout.write(t);",
        "process.stdout.write('z'.repeat(1000));",
        "process.stderr.write('e'.repeat(100003));",
        "process.stderr.write('e'.repeat(200001));",
      ].join("\n"),
      { env: { TOKEN: "{{secret.deploy-token}}" } },
    );
    const result = await runAction(action, {}, { "deploy-token": TOKEN }, opts());
    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(true);
    expect(result.output.length).toBeLessThanOrEqual(32 * 1024 + 100);
    expect(result.output).not.toContain(TOKEN);
    // Not even the ten characters of it that were inside the capture.
    expect(result.output).not.toContain(TOKEN.slice(0, 10));
  });

  test("roda no cwd da ação, relativo à pasta do projeto, e o ambiente do daemon não leva as chaves de API", async () => {
    const base = tempDir();
    const sub = join(base, "sub");
    await Bun.write(join(sub, "marca.txt"), "aqui");
    const cwdAction = make("console.log(require('node:fs').readFileSync('marca.txt','utf8'))", {
      cwd: "sub",
    });
    expect((await runAction(cwdAction, {}, {}, opts({ base }))).output.trim()).toBe("aqui");
    const envAction = make("console.log(Object.keys(process.env).join(','))", {
      env: { LIMPO: "sim" },
    });
    const keys = (
      await runAction(
        envAction,
        {},
        {},
        opts({
          baseEnv: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            ANTHROPIC_API_KEY: "nao-deve-chegar",
            OPENAI_API_KEY: "nem-esta",
          },
        }),
      )
    ).output;
    expect(keys).toContain("LIMPO");
    expect(keys).not.toContain("ANTHROPIC_API_KEY");
  });

  test("um programa que não existe falha com o motivo, sem o segredo", async () => {
    const action = make("", {
      run: ["programa-que-nao-existe-9f3a"],
      env: { T: "{{secret.deploy-token}}" },
    });
    const failed = await code(() => runAction(action, {}, { "deploy-token": TOKEN }, opts()));
    expect(failed).toStartWith("invalid_state:");
    expect(failed).toContain("programa-que-nao-existe-9f3a");
    expect(failed).not.toContain(TOKEN);
  });

  test("ssh: sem executor falha dizendo que depende da Fase 15; com um, monta o destino, o argv e o env, e mascara a saída", async () => {
    const action = make("", {
      ssh: "prod-api",
      run: ["journalctl", "-u", "api", "-n", "{{param.lines}}"],
      params: { lines: { pattern: "^[0-9]{1,4}$", default: "200" } },
      env: { TOKEN: "{{secret.deploy-token}}" },
      timeoutS: 30,
    });
    const without = await code(() =>
      runAction(action, { lines: "10" }, { "deploy-token": TOKEN }, opts()),
    );
    expect(without).toStartWith("invalid_state:");
    expect(without).toContain("Fase 15");
    const jobs: unknown[] = [];
    const result = await runAction(
      action,
      { lines: "10" },
      { "deploy-token": TOKEN },
      opts({
        ssh: async (job) => {
          jobs.push(job);
          return { exitCode: 0, stdout: `linhas com ${TOKEN}\n`, stderr: "" };
        },
      }),
    );
    expect(jobs).toEqual([
      {
        target: "prod-api",
        argv: ["journalctl", "-u", "api", "-n", "10"],
        env: { TOKEN },
        timeoutS: 30,
      },
    ]);
    expect(result.output).toBe("linhas com •••(deploy-token)\n");
  });
});
