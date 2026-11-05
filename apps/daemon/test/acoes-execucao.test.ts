import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
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

/** What a started program was given: its argv, its environment and its folder. */
interface Seen {
  argv: string[];
  env: Record<string, string | undefined>;
  cwd: string;
}

/**
 * A stand-in for `Bun.spawn`: the "program" runs the moment it is started (so the folder and the
 * secret file it was given still exist, as for a real one), and its output comes as the chunks
 * the test gives. No process is started, so these tests do not wait on a loaded machine
 * (issue #231); two tests keep a real process to prove the argv and a missing program.
 */
function program(
  run: (seen: Seen) => { out?: string | string[]; err?: string | string[]; code?: number },
) {
  const seen: Seen[] = [];
  const stream = (parts?: string | string[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of [parts ?? []].flat()) controller.enqueue(new TextEncoder().encode(part));
        controller.close();
      },
    });
  const spawn = ((argv: string[], given: Omit<Seen, "argv">) => {
    const call = { argv, env: given.env, cwd: given.cwd };
    seen.push(call);
    const done = run(call);
    return {
      stdout: stream(done.out),
      stderr: stream(done.err),
      exited: Promise.resolve(done.code ?? 0),
      kill() {},
      pid: 1,
    };
  }) as unknown as typeof Bun.spawn;
  return { spawn, seen };
}

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
    const { spawn, seen } = program(({ env, argv }) => ({
      out: `hash=${sha(env.TOKEN ?? "")} argv=${argv.join(" ")} valor=${env.TOKEN}\n`,
    }));
    const action = make("-", { env: { TOKEN: "{{secret.deploy-token}}" } });
    const result = await runAction(action, {}, { "deploy-token": TOKEN }, opts({ spawn }));
    expect(seen[0]?.env.TOKEN).toBe(TOKEN);
    expect(seen[0]?.argv.join(" ")).not.toContain(TOKEN);
    expect(result.output).toContain(`hash=${sha(TOKEN)}`);
    expect(result.output).toContain("valor=•••(deploy-token)");
    expect(result.output).not.toContain(TOKEN);
    expect(result.exitCode).toBe(0);
  });

  test("o arquivo temporário do segredo existe durante a execução e é apagado depois, até se falhar", async () => {
    let exit = 0;
    const show = ({ argv }: Seen) => {
      const path = argv[3] ?? "";
      const text = readFileSync(path, "utf8");
      return { out: `path=${path}\nhash=${sha(text)}\nconteudo=${text}\n`, code: exit };
    };
    const ok = await runAction(
      make("-", {}, ["{{secretFile.chave}}"]),
      {},
      { chave: KEY },
      opts({ spawn: program(show).spawn }),
    );
    const path = /path=(.*)/.exec(ok.output)?.[1]?.trim() ?? "";
    expect(ok.output).toContain(`hash=${sha(KEY)}`);
    expect(ok.output).not.toContain("linha-um-da-chave");
    expect(path).not.toBe("");
    expect(existsSync(path)).toBe(false);
    exit = 3;
    const failing = await runAction(
      make("-", {}, ["{{secretFile.chave}}"]),
      {},
      { chave: KEY },
      opts({ spawn: program(show).spawn }),
    );
    expect(failing.exitCode).toBe(3);
    expect(existsSync(/path=(.*)/.exec(failing.output)?.[1]?.trim() ?? "")).toBe(false);
    // The same through an env variable that holds the path.
    const viaEnv = await runAction(
      make("-", { env: { KEY_FILE: "{{secretFile.chave}}" } }),
      {},
      { chave: KEY },
      opts({ spawn: program(({ env }) => ({ out: `p=${env.KEY_FILE}\n` })).spawn }),
    );
    expect(existsSync(/p=(.*)/.exec(viaEnv.output)?.[1]?.trim() ?? "?")).toBe(false);
  });

  test("em sistemas POSIX o arquivo do segredo só é legível pelo dono", async () => {
    if (process.platform === "win32") return;
    const result = await runAction(
      make("-", {}, ["{{secretFile.chave}}"]),
      {},
      { chave: KEY },
      opts({
        spawn: program(({ argv }) => ({ out: `${statSync(argv[3] ?? "").mode & 0o777}\n` })).spawn,
      }),
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

  test("a saída vai mascarada, com o stderr, e cortada em 32 KB sem deixar metade de um segredo", async () => {
    const secrets = { "deploy-token": TOKEN, chave: KEY };
    const { spawn } = program(({ env }) => {
      const t = env.TOKEN ?? "";
      return {
        out: [
          `literal ${t}\n`,
          `b64 ${Buffer.from(t).toString("base64")}\n`,
          `hex ${Buffer.from(t).toString("hex")}\n`,
          `url ${encodeURIComponent(t)}\n`,
          `chave\n${env.KEY}\n`,
          `${"x".repeat(100000)}\n`,
          `${t}\n`,
        ],
        err: `erro ${t}\n`,
      };
    });
    const action = make("-", {
      env: { TOKEN: "{{secret.deploy-token}}", KEY: "{{secret.chave}}" },
    });
    const result = await runAction(action, {}, secrets, opts({ spawn }));
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
    // The capture stops at 250,000 characters: the secret starts ten characters before that, and
    // the rest comes as chunks of its own after the capture is full.
    const { spawn } = program(({ env }) => ({
      out: ["y".repeat(250_000 - 10) + (env.TOKEN ?? ""), "z".repeat(1000)],
      err: ["e".repeat(100003), "e".repeat(200001)],
    }));
    const action = make("-", { env: { TOKEN: "{{secret.deploy-token}}" } });
    const result = await runAction(action, {}, { "deploy-token": TOKEN }, opts({ spawn }));
    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(true);
    expect(result.output.length).toBeLessThanOrEqual(32 * 1024 + 100);
    expect(result.output).not.toContain(TOKEN);
    // Not even the ten characters of it that were inside the capture.
    expect(result.output).not.toContain(TOKEN.slice(0, 10));
  });

  test("roda no cwd da ação, relativo à pasta do projeto, e o ambiente do daemon não leva as chaves de API", async () => {
    const base = tempDir();
    const here = program(() => ({}));
    await runAction(make("-", { cwd: "sub" }), {}, {}, opts({ base, spawn: here.spawn }));
    expect(here.seen[0]?.cwd).toBe(join(base, "sub"));
    const envs = program(() => ({}));
    await runAction(
      make("-", { env: { LIMPO: "sim" } }),
      {},
      {},
      opts({
        spawn: envs.spawn,
        baseEnv: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          ANTHROPIC_API_KEY: "nao-deve-chegar",
          OPENAI_API_KEY: "nem-esta",
        },
      }),
    );
    const keys = Object.keys(envs.seen[0]?.env ?? {});
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
    expect(without).toContain("ssh destination");
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
