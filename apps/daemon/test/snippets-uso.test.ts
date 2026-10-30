import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "../src/server.ts";
import { SecretScanner } from "../src/snippets/model.ts";
import { Snippets } from "../src/snippets/store.ts";
import { SnippetUse } from "../src/snippets/use.ts";
import { EventStore } from "../src/store/event-store.ts";
import { TerminalManager } from "../src/terminal/terminal-manager.ts";
import { newManager, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { fakePtys } from "./pty-helpers.ts";

const TOKEN = "snippets-use-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const SPEC_FILE = `- name: testes-rapidos
  type: command
  run: "bun test {{arquivo}}"
  vars: { arquivo: { default: "" } }
- name: revisar-seguranca
  type: prompt
  text: "Revise {{file}} procurando injeção. Responda em tópicos."
`;

function setup() {
  const { root, project } = workspace();
  const store = new EventStore(":memory:");
  const scanner = new SecretScanner();
  const snippets = new Snippets({ db: store.db, allowedRoots: [root], scanner });
  const ptys = fakePtys();
  const terminals = new TerminalManager({
    pty: ptys.factory,
    allowedRoots: [root],
    platform: "linux",
    env: () => ({ PATH: "/bin", SHELL: "/bin/zsh" }),
  });
  cleanups.push(() => terminals.stop());
  const git: string[][] = [];
  let branch = "main\n";
  const sent: Array<[string, string]> = [];
  const external: Array<[string, string]> = [];
  let channel = true;
  const use = new SnippetUse({
    allowedRoots: [root],
    snippets,
    terminals,
    manager: {
      send: (sessionId: string, text: string) => {
        sent.push([sessionId, text]);
        return { queued: false };
      },
    },
    central: {
      external: { get: (id: string) => (id === "claude-1" ? { launchId: "L1" } : undefined) },
      receptor: {
        sendToLaunch: (launch: string, text: string) => {
          external.push([launch, text]);
          return channel;
        },
      },
    } as never,
    exec: async (cmd) => {
      git.push(cmd);
      return { code: branch === "" ? 128 : 0, stdout: branch };
    },
  });
  const writeFile = () => {
    mkdirSync(join(project, ".flightdeck"), { recursive: true });
    writeFileSync(join(project, ".flightdeck", "snippets.yaml"), SPEC_FILE);
  };
  return {
    root,
    project,
    snippets,
    terminals,
    ptys,
    use,
    git,
    sent,
    external,
    writeFile,
    setBranch: (value: string) => {
      branch = value;
    },
    setChannel: (value: boolean) => {
      channel = value;
    },
    host: (name: string, run: string, extra: Record<string, unknown> = {}) =>
      snippets.save({ scope: "host", name, type: "command", run, ...extra }),
    prompt: (name: string, text: string, extra: Record<string, unknown> = {}) =>
      snippets.save({ scope: "host", name, type: "prompt", text, ...extra }),
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
}

describe("snippets-uso: a paleta com variáveis", () => {
  test("render devolve o texto pronto: valores, padrões e o contexto, com a branch lida do cwd", async () => {
    const s = setup();
    const snippet = s.host("deploy", "git -C {{cwd}} push origin {{branch}} --tags {{extra}}", {
      vars: { extra: { default: "--dry-run" } },
    });
    const rendered = await s.use.render({ id: snippet.id, context: { cwd: s.project } });
    expect(rendered.text).toBe(`git -C ${s.project} push origin main --tags --dry-run`);
    expect(rendered.fields.map((f) => f.name)).toEqual(["cwd", "branch", "extra"]);
    expect(s.git).toEqual([["git", "-C", s.project, "rev-parse", "--abbrev-ref", "HEAD"]]);
    const custom = await s.use.render({
      id: snippet.id,
      values: { extra: "" },
      context: { cwd: s.project },
    });
    expect(custom.text.endsWith("--tags ")).toBe(true);
  });

  test("a branch só é lida quando o modelo a usa, só em pasta permitida, e HEAD solto ou fora de repositório é faltar valor", async () => {
    const s = setup();
    const plain = s.host("ls", "ls -la {{cwd}}");
    await s.use.render({ id: plain.id, context: { cwd: s.project } });
    expect(s.git).toEqual([]);
    const branchy = s.host("branch", "echo {{branch}}");
    expect(
      await codeOf(s.use.render({ id: branchy.id, context: { cwd: join(s.root, "..", "fora") } })),
    ).toBe("forbidden_cwd");
    expect(s.git).toEqual([]);
    expect(await codeOf(s.use.render({ id: branchy.id }))).toBe("bad_request");
    s.setBranch("HEAD\n");
    expect(await codeOf(s.use.render({ id: branchy.id, context: { cwd: s.project } }))).toBe(
      "bad_request",
    );
    s.setBranch("");
    expect(await codeOf(s.use.render({ id: branchy.id, context: { cwd: s.project } }))).toBe(
      "bad_request",
    );
    // The file and the selection come from the app; a value of the user wins over the default.
    const withFile = s.prompt("revisar", "Revise {{file}}: {{selection}}");
    expect(
      (await s.use.render({ id: withFile.id, context: { file: "a.ts", selection: "x\ny" } })).text,
    ).toBe("Revise a.ts: x\ny");
    expect(await codeOf(s.use.render({ id: "nada" }))).toBe("not_found");
  });
});

describe("snippets-uso: colar e rodar no terminal", () => {
  async function terminal(s: ReturnType<typeof setup>) {
    return s.terminals.open({ cwd: s.project, cols: 80, rows: 24 });
  }

  test("colar escreve o comando no terminal sem Enter, e com Enter quando se pede; conta como uso", async () => {
    const s = setup();
    const { terminalId } = await terminal(s);
    const snippet = s.host("testes", "bun test {{arquivo}}", {
      vars: { arquivo: { default: "a.test.ts" } },
    });
    const pasted = await s.use.use({ id: snippet.id, action: "paste", terminalId });
    expect(pasted).toMatchObject({ text: "bun test a.test.ts", terminal: null });
    expect(s.ptys.spawned[0]?.written).toEqual(["bun test a.test.ts"]);
    await s.use.use({
      id: snippet.id,
      action: "paste",
      terminalId,
      enter: true,
      values: { arquivo: "b.test.ts" },
    });
    expect(s.ptys.spawned[0]?.written).toEqual(["bun test a.test.ts", "bun test b.test.ts\r"]);
    expect(s.snippets.get(snippet.id).uses).toBe(2);
    expect(await codeOf(s.use.use({ id: snippet.id, action: "paste", terminalId: "nada" }))).toBe(
      "not_found",
    );
    expect(await codeOf(s.use.use({ id: snippet.id, action: "paste" }))).toBe("bad_request");
  });

  test("um comando do arquivo sem confiança só cola, sem Enter: com Enter ou rodando é snippet_untrusted e nada é escrito", async () => {
    const s = setup();
    s.writeFile();
    const { terminalId } = await terminal(s);
    const id = `file:${s.project}:testes-rapidos`;
    expect((await s.use.use({ id, action: "paste", terminalId })).text).toBe("bun test ");
    expect(await codeOf(s.use.use({ id, action: "paste", terminalId, enter: true }))).toBe(
      "snippet_untrusted",
    );
    expect(await codeOf(s.use.use({ id, action: "run", context: { cwd: s.project } }))).toBe(
      "snippet_untrusted",
    );
    expect(s.ptys.spawned).toHaveLength(1);
    expect(s.ptys.spawned[0]?.written).toEqual(["bun test "]);
    // Trusted by hash, it runs.
    const hash = s.snippets.list({ projectPath: s.project }).file?.hash ?? "";
    s.snippets.trust(s.project, hash);
    await s.use.use({ id, action: "paste", terminalId, enter: true });
    expect(s.ptys.spawned[0]?.written).toEqual(["bun test ", "bun test \r"]);
    // The failed attempts did not count as uses.
    expect(s.snippets.get(id).uses).toBe(2);
  });

  test("rodar abre uma aba nova no cwd escolhido e escreve o comando com Enter", async () => {
    const s = setup();
    const snippet = s.host("hora", "date");
    const ran = await s.use.use({
      id: snippet.id,
      action: "run",
      context: { cwd: s.project },
      cols: 100,
      rows: 30,
    });
    expect(ran.text).toBe("date");
    expect(ran.terminal).toMatchObject({ cwd: s.project, cols: 100, rows: 30, exitCode: null });
    expect(s.ptys.spawned[0]).toMatchObject({
      cwd: s.project,
      cols: 100,
      rows: 30,
      written: ["date\r"],
    });
    // Without a size the usual one; without a cwd, or outside the allowed folders, no terminal.
    expect(
      (await s.use.use({ id: snippet.id, action: "run", context: { cwd: s.project } })).terminal,
    ).toMatchObject({
      cols: 120,
      rows: 30,
    });
    expect(await codeOf(s.use.use({ id: snippet.id, action: "run" }))).toBe("bad_request");
    expect(
      await codeOf(
        s.use.use({ id: snippet.id, action: "run", context: { cwd: join(s.root, "..", "x") } }),
      ),
    ).toBe("forbidden_cwd");
    expect(s.ptys.spawned).toHaveLength(2);
  });

  test("falta de valor ou valor inseguro não escreve nada nem conta como uso", async () => {
    const s = setup();
    const { terminalId } = await terminal(s);
    const snippet = s.host("eco", "echo {{msg}}");
    expect(await codeOf(s.use.use({ id: snippet.id, action: "paste", terminalId }))).toBe(
      "bad_request",
    );
    expect(
      await codeOf(
        s.use.use({ id: snippet.id, action: "paste", terminalId, values: { msg: "a\nrm -rf x" } }),
      ),
    ).toBe("bad_request");
    expect(s.ptys.spawned[0]?.written).toEqual([]);
    expect(s.snippets.get(snippet.id).uses).toBe(0);
  });
});

describe("snippets-uso: enviar à sessão", () => {
  test("um prompt vai à sessão gerenciada ou à sessão de terminal controlável, e conta como uso", async () => {
    const s = setup();
    const snippet = s.prompt("revisar", "Revise {{file}} com cuidado.");
    const managed = await s.use.use({
      id: snippet.id,
      action: "send",
      sessionId: "s1",
      context: { file: "a.ts" },
    });
    expect(managed).toMatchObject({ text: "Revise a.ts com cuidado.", terminal: null });
    expect(s.sent).toEqual([["s1", "Revise a.ts com cuidado."]]);
    await s.use.use({
      id: snippet.id,
      action: "send",
      claudeSessionId: "claude-1",
      context: { file: "b.ts" },
    });
    expect(s.external).toEqual([["L1", "Revise b.ts com cuidado."]]);
    expect(s.snippets.get(snippet.id).uses).toBe(2);
  });

  test("a sessão: uma só, que exista e tenha canal; e o tipo certo para cada ação", async () => {
    const s = setup();
    const prompt = s.prompt("oi", "Oi");
    const command = s.host("ls", "ls -la");
    const both = {
      id: prompt.id,
      action: "send" as const,
      sessionId: "s1",
      claudeSessionId: "claude-1",
    };
    expect(await codeOf(s.use.use(both))).toBe("bad_request");
    expect(await codeOf(s.use.use({ id: prompt.id, action: "send" }))).toBe("bad_request");
    expect(
      await codeOf(s.use.use({ id: prompt.id, action: "send", claudeSessionId: "outra" })),
    ).toBe("not_found");
    s.setChannel(false);
    expect(
      await codeOf(s.use.use({ id: prompt.id, action: "send", claudeSessionId: "claude-1" })),
    ).toBe("invalid_state");
    // A prompt is sent; a command is pasted or run.
    expect(await codeOf(s.use.use({ id: command.id, action: "send", sessionId: "s1" }))).toBe(
      "bad_request",
    );
    expect(await codeOf(s.use.use({ id: prompt.id, action: "paste", terminalId: "t" }))).toBe(
      "bad_request",
    );
    expect(
      await codeOf(s.use.use({ id: prompt.id, action: "run", context: { cwd: s.project } })),
    ).toBe("bad_request");
    expect(s.snippets.get(prompt.id).uses).toBe(0);
  });

  test("um prompt do arquivo é enviado sem confiança", async () => {
    const s = setup();
    s.writeFile();
    const id = `file:${s.project}:revisar-seguranca`;
    const result = await s.use.use({
      id,
      action: "send",
      sessionId: "s1",
      context: { file: "x.ts" },
    });
    expect(result.text).toBe("Revise x.ts procurando injeção. Responda em tópicos.");
  });
});

describe("snippets-uso: pelo protocolo", () => {
  async function connect(s: ReturnType<typeof setup> | null) {
    const { root } = workspace();
    const server = startServer({
      manager: newManager().manager,
      ...(s ? { snippets: s.snippets, snippetUse: s.use, terminals: s.terminals } : {}),
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const codeOfCall = async (type: string, payload: unknown) =>
      ((await client.request(type, payload)).error as { code?: string } | undefined)?.code ?? "ok";
    return { client, codeOfCall };
  }

  test("snippets.render e snippets.use", async () => {
    const s = setup();
    const { client, codeOfCall } = await connect(s);
    const snippet = s.host("eco", "echo {{msg}}");
    expect(
      await client.data("snippets.render", { id: snippet.id, values: { msg: "oi" } }),
    ).toMatchObject({
      text: "echo oi",
      fields: [{ name: "msg", special: false }],
    });
    const { terminalId } = s.terminals.open({ cwd: s.project, cols: 80, rows: 24 });
    expect(
      await client.data("snippets.use", {
        id: snippet.id,
        action: "paste",
        terminalId,
        values: { msg: "oi" },
      }),
    ).toMatchObject({ text: "echo oi", terminal: null });
    expect(s.ptys.spawned[0]?.written).toEqual(["echo oi"]);
    expect(await codeOfCall("snippets.use", { id: snippet.id, action: "explodir" })).toBe(
      "bad_request",
    );
    expect(
      await codeOfCall("snippets.use", { id: snippet.id, action: "paste", terminalId, extra: 1 }),
    ).toBe("bad_request");
  });

  test("sem o uso configurado, diz que está desativado", async () => {
    const { codeOfCall } = await connect(null);
    expect(await codeOfCall("snippets.render", { id: "x" })).toBe("invalid_state");
    expect(await codeOfCall("snippets.use", { id: "x", action: "paste", terminalId: "t" })).toBe(
      "invalid_state",
    );
  });
});
