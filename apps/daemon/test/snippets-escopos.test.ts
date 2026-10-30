import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Snippet } from "@flightdeck/protocol";
import { startServer } from "../src/server.ts";
import { SecretScanner } from "../src/snippets/model.ts";
import { Snippets } from "../src/snippets/store.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "snippets-token-0123456789abcdef0123";
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
  text: "Revise {{file}} procurando injeção, segredos expostos e validação faltando. Responda em tópicos."
`;

function setup(scanner = new SecretScanner()) {
  const { root, project } = workspace();
  const other = join(root, "outro");
  mkdirSync(other);
  let clock = Date.parse("2026-10-29T12:00:00Z");
  const store = new EventStore(":memory:");
  const snippets = new Snippets({
    db: store.db,
    allowedRoots: [root],
    scanner,
    now: () => clock,
  });
  const file = join(project, ".flightdeck", "snippets.yaml");
  const writeFile = (text: string) => {
    mkdirSync(join(project, ".flightdeck"), { recursive: true });
    writeFileSync(file, text);
  };
  return {
    root,
    project,
    other,
    snippets,
    file,
    writeFile,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
}

const cmd = (name: string, run = "ls", extra: Record<string, unknown> = {}) => ({
  scope: "host" as const,
  name,
  type: "command" as const,
  run,
  ...extra,
});
const names = (list: Snippet[]) => list.map((s) => s.name);

describe("snippets-escopos: do host", () => {
  test("salvar, listar, buscar, atualizar e remover; o mesmo nome em dois escopos pode, no mesmo não", () => {
    const { snippets, project } = setup();
    const saved = snippets.save(cmd("status", "git status", { tags: ["git"] }));
    expect(saved).toMatchObject({
      scope: "host",
      source: "daemon",
      projectPath: null,
      name: "status",
      type: "command",
      run: "git status",
      text: null,
      tags: ["git"],
      fields: [],
      favorite: false,
      uses: 0,
      lastUsedAt: null,
      runnable: true,
    });
    expect(saved.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(snippets.list({}).snippets.map((s) => s.id)).toEqual([saved.id]);
    expect(snippets.get(saved.id).name).toBe("status");
    // Same name, same scope: refused. Same name in the project: fine.
    expect(codeOf(() => snippets.save(cmd("status", "git status -s")))).toBe("invalid_state");
    expect(
      codeOf(() => snippets.save(cmd("status", "x", { scope: "project", projectPath: project }))),
    ).toBe("ok");
    const updated = snippets.save({ ...cmd("status", "git status -sb"), id: saved.id });
    expect(updated).toMatchObject({ id: saved.id, run: "git status -sb" });
    expect(snippets.list({}).snippets).toHaveLength(1);
    // A snippet cannot change scope: create another.
    expect(
      codeOf(() =>
        snippets.save({ ...cmd("status"), id: saved.id, scope: "project", projectPath: project }),
      ),
    ).toBe("bad_request");
    snippets.remove(saved.id);
    expect(snippets.list({}).snippets).toEqual([]);
    expect(codeOf(() => snippets.get(saved.id))).toBe("not_found");
    expect(codeOf(() => snippets.remove(saved.id))).toBe("not_found");
    expect(codeOf(() => snippets.save({ ...cmd("x"), id: "nada" }))).toBe("not_found");
  });

  test("um snippet com segredo é recusado, também no nome e nas tags", () => {
    const { snippets } = setup();
    const token = "ghp_0123456789abcdef0123456789abcdef0123";
    expect(codeOf(() => snippets.save(cmd("a", `echo ${token}`)))).toBe("snippet_secret");
    expect(codeOf(() => snippets.save(cmd("b", "ls", { tags: [token] })))).toBe("snippet_secret");
    expect(snippets.list({}).snippets).toEqual([]);
  });
});

describe("snippets-escopos: do projeto", () => {
  test("o do daemon é só daquele projeto, que precisa estar nas pastas permitidas", () => {
    const { snippets, project, other, root } = setup();
    const mine = snippets.save({
      ...cmd("build", "bun run build"),
      scope: "project",
      projectPath: project,
    });
    expect(mine).toMatchObject({ scope: "project", source: "daemon", projectPath: project });
    snippets.save(cmd("global-do-host", "uptime"));
    expect(names(snippets.list({ projectPath: project }).snippets).sort()).toEqual([
      "build",
      "global-do-host",
    ]);
    // The host list does not carry the project ones, and another project does not see them.
    expect(names(snippets.list({}).snippets)).toEqual(["global-do-host"]);
    expect(names(snippets.list({ projectPath: other }).snippets)).toEqual(["global-do-host"]);
    expect(names(snippets.list({ scope: "project", projectPath: project }).snippets)).toEqual([
      "build",
    ]);
    expect(names(snippets.list({ scope: "host", projectPath: project }).snippets)).toEqual([
      "global-do-host",
    ]);
    expect(codeOf(() => snippets.save({ ...cmd("x"), scope: "project" }))).toBe("bad_request");
    expect(
      codeOf(() =>
        snippets.save({ ...cmd("x"), scope: "project", projectPath: join(root, "..", "fora") }),
      ),
    ).toBe("forbidden_cwd");
    expect(codeOf(() => snippets.list({ projectPath: join(root, "..", "fora") }))).toBe(
      "forbidden_cwd",
    );
    expect(codeOf(() => snippets.list({ scope: "project" }))).toBe("bad_request");
  });

  test("o .flightdeck/snippets.yaml carrega: o comando não roda sem confiança, o prompt sim, e sem arquivo não há nada", () => {
    const { snippets, project, file, writeFile } = setup();
    expect(snippets.list({ projectPath: project })).toEqual({ snippets: [], file: null });
    writeFile(SPEC_FILE);
    const listed = snippets.list({ projectPath: project });
    expect(listed.file).toMatchObject({ path: file, trusted: false, errors: [] });
    expect(listed.file?.hash).toMatch(/^[0-9a-f]{64}$/);
    const byName = Object.fromEntries(listed.snippets.map((s) => [s.name, s]));
    expect(byName["testes-rapidos"]).toMatchObject({
      scope: "project",
      source: "file",
      projectPath: project,
      type: "command",
      run: "bun test {{arquivo}}",
      vars: { arquivo: { default: "" } },
      fields: [{ name: "arquivo", special: false, default: "", options: [] }],
      runnable: false,
    });
    expect(byName["testes-rapidos"]?.id).toBe(`file:${project}:testes-rapidos`);
    // A prompt needs no trust.
    expect(byName["revisar-seguranca"]).toMatchObject({ type: "prompt", runnable: true });
  });

  test("confiar no hash libera o comando; o arquivo mudando tira a confiança; o hash errado é recusado", () => {
    const { snippets, project, writeFile } = setup();
    writeFile(SPEC_FILE);
    const hash = snippets.list({ projectPath: project }).file?.hash ?? "";
    expect(codeOf(() => snippets.trust(project, "0".repeat(64)))).toBe("invalid_state");
    expect(snippets.trust(project, hash)).toMatchObject({ hash, trusted: true });
    const run = () =>
      snippets.list({ projectPath: project }).snippets.find((s) => s.name === "testes-rapidos")
        ?.runnable;
    expect(run()).toBe(true);
    // Trusting twice is fine; a change to the file is a different hash and is not trusted.
    snippets.trust(project, hash);
    writeFile(SPEC_FILE.replace("bun test", "bun test --bail"));
    expect(snippets.list({ projectPath: project }).file?.trusted).toBe(false);
    expect(run()).toBe(false);
    // Back to the trusted content: trusted again, the hash is what counts.
    writeFile(SPEC_FILE);
    expect(run()).toBe(true);
    expect(codeOf(() => snippets.trust(project, hash))).toBe("ok");
    const missing = join(project, "..", "outro");
    expect(codeOf(() => snippets.trust(missing, hash))).toBe("invalid_state");
  });

  test("entradas ruins do arquivo ficam de fora com o motivo, sem derrubar as boas; um YAML quebrado não derruba nada", () => {
    const { snippets, project, writeFile } = setup();
    writeFile(
      [
        "- name: boa",
        "  type: command",
        '  run: "ls"',
        "- name: com-segredo",
        "  type: command",
        '  run: "echo ghp_0123456789abcdef0123456789abcdef0123"',
        "- name: sem-run",
        "  type: command",
        '- name: "boa"',
        "  type: prompt",
        '  text: "duplicada"',
        "- 42",
        "",
      ].join("\n"),
    );
    const listed = snippets.list({ projectPath: project });
    expect(names(listed.snippets)).toEqual(["boa"]);
    expect(listed.file?.errors).toHaveLength(4);
    expect(listed.file?.errors.join("|")).toMatch(/com-segredo.*segredo/);
    expect(listed.file?.errors.join("|")).toMatch(/sem-run/);
    expect(listed.file?.errors.join("|")).toMatch(/boa.*repetido/);
    writeFile("isto: [não é uma lista");
    const broken = snippets.list({ projectPath: project });
    expect(broken.snippets).toEqual([]);
    expect(broken.file?.errors[0]).toMatch(/YAML/);
    writeFile("nome: não é lista\n");
    expect(snippets.list({ projectPath: project }).file?.errors[0]).toMatch(/lista/);
  });

  test("salvar no arquivo escreve YAML em blocos que volta igual, cria a pasta, tira a confiança e guarda os outros", () => {
    const { snippets, project, file } = setup();
    const first = snippets.save({
      scope: "project",
      target: "file",
      projectPath: project,
      name: "testes-rapidos",
      type: "command",
      run: "bun test {{arquivo}}",
      vars: { arquivo: { default: "", options: [] } },
      tags: ["bun", "ci"],
    });
    expect(first).toMatchObject({
      source: "file",
      id: `file:${project}:testes-rapidos`,
      runnable: false,
    });
    snippets.save({
      scope: "project",
      target: "file",
      projectPath: project,
      name: "revisar",
      type: "prompt",
      text: 'Revise {{file}} com "aspas" e acentuação.',
    });
    expect(readFileSync(file, "utf8")).toBe(
      [
        '- name: "testes-rapidos"',
        "  type: command",
        '  run: "bun test {{arquivo}}"',
        "  vars:",
        '    arquivo: { default: "" }',
        '  tags: ["bun", "ci"]',
        '- name: "revisar"',
        "  type: prompt",
        '  text: "Revise {{file}} com \\"aspas\\" e acentuação."',
        "",
      ].join("\n"),
    );
    expect((Bun.YAML.parse(readFileSync(file, "utf8")) as unknown[]).length).toBe(2);
    expect(names(snippets.list({ projectPath: project }).snippets).sort()).toEqual([
      "revisar",
      "testes-rapidos",
    ]);
    // The file changed: whatever was trusted before is not anymore.
    const hash = snippets.list({ projectPath: project }).file?.hash ?? "";
    snippets.trust(project, hash);
    snippets.save({
      scope: "project",
      target: "file",
      projectPath: project,
      name: "extra",
      type: "command",
      run: "echo {{x}}",
      vars: { x: { default: "a", options: ["a", "b"] } },
    });
    expect(snippets.list({ projectPath: project }).file?.trusted).toBe(false);
  });

  test("editar, renomear e remover no arquivo; o último removido deixa uma lista vazia", () => {
    const { snippets, project, file, writeFile } = setup();
    writeFile(SPEC_FILE);
    const id = `file:${project}:revisar-seguranca`;
    const renamed = snippets.save({
      id,
      scope: "project",
      target: "file",
      projectPath: project,
      name: "revisar",
      type: "prompt",
      text: "Revise {{file}}.",
    });
    expect(renamed.id).toBe(`file:${project}:revisar`);
    expect(names(snippets.list({ projectPath: project }).snippets).sort()).toEqual([
      "revisar",
      "testes-rapidos",
    ]);
    expect(
      codeOf(() =>
        snippets.save({
          id: renamed.id,
          scope: "project",
          target: "file",
          projectPath: project,
          name: "testes-rapidos",
          type: "prompt",
          text: "x",
        }),
      ),
    ).toBe("invalid_state");
    expect(codeOf(() => snippets.get(id))).toBe("not_found");
    snippets.remove(renamed.id);
    snippets.remove(`file:${project}:testes-rapidos`);
    expect(readFileSync(file, "utf8")).toBe("[]\n");
    expect(codeOf(() => snippets.remove(`file:${project}:testes-rapidos`))).toBe("not_found");
    expect(codeOf(() => snippets.remove("file:sem-nome"))).toBe("not_found");
  });

  test("salvar no arquivo recusa segredo (também nas tags), um arquivo com erros e um nome já usado no projeto", () => {
    const { snippets, project, file, writeFile } = setup();
    const token = "ghp_0123456789abcdef0123456789abcdef0123";
    const toFile = (extra: Record<string, unknown>) => () =>
      snippets.save({
        scope: "project",
        target: "file",
        projectPath: project,
        name: "novo",
        type: "command",
        run: "ls",
        ...extra,
      });
    expect(codeOf(toFile({ run: `echo ${token}` }))).toBe("snippet_secret");
    expect(codeOf(toFile({ tags: [token] }))).toBe("snippet_secret");
    expect(existsSync(file)).toBe(false);
    snippets.save({
      scope: "project",
      projectPath: project,
      name: "novo",
      type: "command",
      run: "ls",
    });
    expect(codeOf(toFile({}))).toBe("invalid_state");
    writeFile("- 42\n");
    expect(codeOf(toFile({ name: "outro" }))).toBe("invalid_state");
    expect(readFileSync(file, "utf8")).toBe("- 42\n");
  });
});

describe("snippets-escopos: favoritos, recentes e busca", () => {
  test("favoritos no topo, depois os usados por último, depois por nome; os marcadores seguem o snippet e somem com ele", () => {
    const { snippets, tick } = setup();
    const a = snippets.save(cmd("alfa"));
    const b = snippets.save(cmd("beta"));
    const c = snippets.save(cmd("gama"));
    expect(names(snippets.list({}).snippets)).toEqual(["alfa", "beta", "gama"]);
    snippets.markUsed(b.id);
    tick(1000);
    snippets.markUsed(c.id);
    tick(1000);
    snippets.markUsed(c.id);
    expect(names(snippets.list({}).snippets)).toEqual(["gama", "beta", "alfa"]);
    expect(snippets.get(c.id)).toMatchObject({ uses: 2, lastUsedAt: "2026-10-29T12:00:02.000Z" });
    expect(snippets.favorite(a.id, true)).toMatchObject({ id: a.id, favorite: true });
    expect(names(snippets.list({}).snippets)).toEqual(["alfa", "gama", "beta"]);
    // Renaming keeps the marks; unfavoriting puts it back in the order of use.
    snippets.save({ ...cmd("alfa-novo"), id: a.id });
    expect(snippets.get(a.id)).toMatchObject({ name: "alfa-novo", favorite: true });
    snippets.favorite(a.id, false);
    expect(names(snippets.list({}).snippets)).toEqual(["gama", "beta", "alfa-novo"]);
    snippets.remove(c.id);
    expect(codeOf(() => snippets.markUsed(c.id))).toBe("not_found");
    expect(codeOf(() => snippets.favorite("nada", true))).toBe("not_found");
  });

  test("os do arquivo também têm favoritos e recentes", () => {
    const { snippets, project, writeFile } = setup();
    writeFile(SPEC_FILE);
    const id = `file:${project}:revisar-seguranca`;
    snippets.favorite(id, true);
    snippets.markUsed(id);
    const listed = snippets.list({ projectPath: project }).snippets;
    expect(listed[0]).toMatchObject({ name: "revisar-seguranca", favorite: true, uses: 1 });
    expect(codeOf(() => snippets.favorite(`file:${project}:nao-existe`, true))).toBe("not_found");
  });

  test("a busca olha o nome, as tags e o conteúdo sem diferenciar maiúsculas; filtra por tag e tipo", () => {
    const { snippets } = setup();
    snippets.save(cmd("deploy", "kubectl apply -f app.yaml", { tags: ["Prod", "k8s"] }));
    snippets.save({
      scope: "host",
      name: "explicar",
      type: "prompt",
      text: "Explique o Kubernetes",
      tags: ["ia"],
    });
    snippets.save(cmd("limpar", "docker system prune"));
    const search = (filter: Parameters<Snippets["list"]>[0]) =>
      names(snippets.list(filter).snippets).sort();
    expect(search({ query: "KUBE" })).toEqual(["deploy", "explicar"]);
    expect(search({ query: "prod" })).toEqual(["deploy"]);
    expect(search({ query: "limp" })).toEqual(["limpar"]);
    expect(search({ query: "" })).toEqual(["deploy", "explicar", "limpar"]);
    expect(search({ tag: "k8s" })).toEqual(["deploy"]);
    expect(search({ type: "prompt" })).toEqual(["explicar"]);
    expect(search({ type: "command", query: "kube" })).toEqual(["deploy"]);
  });
});

describe("snippets-escopos: pelo protocolo", () => {
  async function connect(snippets: Snippets | null, root: string) {
    const server = startServer({
      manager: newManager().manager,
      ...(snippets ? { snippets } : {}),
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

  test("snippets.list, save, get, remove, favorite e trust", async () => {
    const { snippets, root, project, writeFile } = setup();
    const { client, codeOfCall } = await connect(snippets, root);
    const saved = await client.data<Snippet>("snippets.save", {
      scope: "host",
      name: "status",
      type: "command",
      run: "git status",
    });
    expect(saved?.name).toBe("status");
    expect(await client.data("snippets.list", {})).toMatchObject({
      snippets: [{ id: saved?.id }],
      file: null,
    });
    expect(await client.data("snippets.get", { id: saved?.id })).toMatchObject({ name: "status" });
    expect(await client.data("snippets.get", { name: "status" })).toMatchObject({ id: saved?.id });
    expect(await codeOfCall("snippets.get", {})).toBe("bad_request");
    expect(await codeOfCall("snippets.get", { name: "nada" })).toBe("not_found");
    expect(await client.data("snippets.favorite", { id: saved?.id, favorite: true })).toMatchObject(
      {
        favorite: true,
      },
    );
    writeFile(SPEC_FILE);
    const listed = await client.data<{ file: { hash: string } }>("snippets.list", {
      projectPath: project,
    });
    expect(
      await client.data("snippets.trust", { projectPath: project, hash: listed?.file.hash }),
    ).toMatchObject({
      trusted: true,
    });
    expect(
      await codeOfCall("snippets.save", {
        scope: "host",
        name: "x",
        type: "command",
        run: "ls",
        extra: 1,
      }),
    ).toBe("bad_request");
    expect(
      await codeOfCall("snippets.save", {
        scope: "host",
        name: "x",
        type: "command",
        run: "echo ghp_0123456789abcdef0123456789abcdef0123",
      }),
    ).toBe("snippet_secret");
    expect(await codeOfCall("snippets.remove", { id: saved?.id })).toBe("ok");
    expect(await codeOfCall("snippets.remove", { id: saved?.id })).toBe("not_found");
  });

  test("sem o armazenamento configurado, os comandos de snippets dizem que está desativado", async () => {
    const { root } = workspace();
    const { codeOfCall } = await connect(null, root);
    for (const [type, payload] of [
      ["snippets.list", {}],
      ["snippets.save", { scope: "host", name: "x", type: "command", run: "ls" }],
      ["snippets.get", { name: "x" }],
      ["snippets.remove", { id: "x" }],
      ["snippets.trust", { projectPath: "/x", hash: "h" }],
      ["snippets.favorite", { id: "x", favorite: true }],
    ] as const) {
      expect([type, await codeOfCall(type, payload)]).toEqual([type, "invalid_state"]);
    }
  });
});
