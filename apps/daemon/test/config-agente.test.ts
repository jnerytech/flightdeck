import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { AgentConfig } from "../src/agentcfg/files.ts";
import { startServer } from "../src/server.ts";
import { newBoard } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "agentcfg-token-0123456789abc";
const sha = (text: string | Buffer) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

const AGENT =
  "---\nname: revisor\ndescription: revisa o diff\ntools: Read, Grep\nmodel: sonnet\n---\nRevise.\n";
const SKILL = "---\nname: deploy\ndescription: publica\n---\nPassos.\n";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function put(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** Every file under a folder with its hash, to show it never changed. */
function fingerprint(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      out[path] = sha(readFileSync(path));
    }
  }
  return out;
}

/** A project with CLAUDE.md files, agents and a skill, and a user ~/.claude elsewhere. */
function setup() {
  const project = tempDir("fd-agentcfg-");
  put(project, "CLAUDE.md", "# raiz\n");
  put(project, ".claude/CLAUDE.md", "# dentro do .claude\n");
  put(project, "CLAUDE.local.md", "# local\n");
  put(project, "pacotes/web/CLAUDE.md", "# subpasta\n");
  put(project, "node_modules/lib/CLAUDE.md", "# de dependência\n");
  put(project, ".claude/agents/revisor.md", AGENT);
  put(project, ".claude/agents/quebrado.md", "sem frontmatter\n");
  put(project, ".claude/skills/deploy/SKILL.md", SKILL);
  const claudeDir = tempDir("fd-claude-");
  put(claudeDir, "CLAUDE.md", "# do usuário\n");
  put(claudeDir, "agents/global.md", "---\nname: global\ndescription: do usuário\n---\n");
  put(claudeDir, "skills/util/SKILL.md", "---\nname: util\ndescription: do usuário\n---\n");
  return { project, claudeDir, config: new AgentConfig({ claudeDir }) };
}

async function code(fn: () => unknown): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).message;
  }
}

const write = (content: string, expectedHash: string | null, path = ".claude/agents/novo.md") => ({
  kind: "agent" as const,
  path,
  content,
  expectedHash,
  confirm: true,
});

describe("config-agente", () => {
  test("lista os CLAUDE.md do projeto (raiz, .claude, local e subpastas, sem dependências) e o do usuário só leitura", () => {
    const { config, project } = setup();
    expect(
      config.list(project, "claudemd").map((i) => [i.path, i.origin, i.readOnly, i.hash]),
    ).toEqual([
      [".claude/CLAUDE.md", "project", false, sha("# dentro do .claude\n")],
      ["CLAUDE.local.md", "project", false, sha("# local\n")],
      ["CLAUDE.md", "project", false, sha("# raiz\n")],
      ["pacotes/web/CLAUDE.md", "project", false, sha("# subpasta\n")],
      ["CLAUDE.md", "user", true, sha("# do usuário\n")],
    ]);
  });

  test("lista agentes e skills com nome e descrição do frontmatter; os do usuário só leitura", () => {
    const { config, project } = setup();
    expect(
      config
        .list(project, "agent")
        .map((i) => [i.path, i.origin, i.readOnly, i.name, i.description]),
    ).toEqual([
      [".claude/agents/quebrado.md", "project", false, undefined, undefined],
      [".claude/agents/revisor.md", "project", false, "revisor", "revisa o diff"],
      ["agents/global.md", "user", true, "global", "do usuário"],
    ]);
    expect(config.list(project, "skill").map((i) => [i.path, i.origin, i.name])).toEqual([
      [".claude/skills/deploy/SKILL.md", "project", "deploy"],
      ["skills/util/SKILL.md", "user", "util"],
    ]);
  });

  test("lê com o hash do conteúdo; o do usuário também, só leitura; arquivo que não existe é not_found", async () => {
    const { config, project } = setup();
    expect(config.read(project, "agent", ".claude/agents/revisor.md")).toMatchObject({
      content: AGENT,
      hash: sha(AGENT),
      readOnly: false,
    });
    expect(config.read(project, "claudemd", "CLAUDE.md", "user")).toMatchObject({
      content: "# do usuário\n",
      origin: "user",
      readOnly: true,
    });
    expect(await code(() => config.read(project, "agent", ".claude/agents/nada.md"))).toBe(
      "not_found",
    );
  });

  test("gravar pede confirm e o hash de quando foi aberto; hash velho é conflito e não muda o arquivo", async () => {
    const { config, project } = setup();
    const path = ".claude/agents/revisor.md";
    const edited = AGENT.replace("Revise.", "Revise com calma.");
    expect(
      await code(() =>
        config.write(project, { ...write(edited, sha(AGENT), path), confirm: false }),
      ),
    ).toBe("invalid_state");
    expect(config.write(project, write(edited, sha(AGENT), path))).toEqual({ hash: sha(edited) });
    expect(readFileSync(join(project, path), "utf8")).toBe(edited);
    expect(await code(() => config.write(project, write(AGENT, sha(AGENT), path)))).toBe(
      "invalid_state",
    );
    expect(readFileSync(join(project, path), "utf8")).toBe(edited);
  });

  test("criar com expectedHash null gera as pastas; criar por cima de um que existe é conflito", async () => {
    const { config, project } = setup();
    const skill = "---\nname: nova\ndescription: criada pelo app\n---\n";
    const path = ".claude/skills/nova/SKILL.md";
    expect(config.write(project, { ...write(skill, null, path), kind: "skill" })).toEqual({
      hash: sha(skill),
    });
    expect(readFileSync(join(project, path), "utf8")).toBe(skill);
    expect(
      await code(() =>
        config.write(project, {
          ...write(skill, null, ".claude/skills/deploy/SKILL.md"),
          kind: "skill",
        }),
      ),
    ).toBe("invalid_state");
    expect(readFileSync(join(project, ".claude/skills/deploy/SKILL.md"), "utf8")).toBe(SKILL);
  });

  test("frontmatter validado antes de salvar; CLAUDE.md não tem frontmatter", async () => {
    const { config, project } = setup();
    const refused = async (content: string, kind: "agent" | "skill" = "agent") =>
      code(() =>
        config.write(project, {
          ...write(
            content,
            null,
            kind === "agent" ? ".claude/agents/x.md" : ".claude/skills/x/SKILL.md",
          ),
          kind,
        }),
      );
    expect(await refused("sem frontmatter\n")).toBe("bad_request");
    expect(await refused("---\nname: x\n---\n")).toBe("bad_request");
    expect(await refused("---\nname: x\ndescription: d\ntools: 3\n---\n")).toBe("bad_request");
    expect(await refused("---\nname: x\ndescription: d\nmodel: [a]\n---\n")).toBe("bad_request");
    expect(await refused("---\nname: [x\n---\n")).toBe("bad_request");
    // Valid YAML that is not a mapping: empty, or a list.
    expect(await refused("---\n \n---\n")).toBe("bad_request");
    expect(await refused("---\n- a\n- b\n---\n")).toBe("bad_request");
    expect(await refused("---\ndescription: d\n---\n", "skill")).toBe("bad_request");
    expect(await refused("---\nname: x\ndescription: d\ntools: [Read, Grep]\n---\n")).toBe("ok");
    expect(await refused("---\r\nname: y\r\ndescription: d\r\n---\r\n", "skill")).toBe("ok");
    expect(
      config.write(project, {
        ...write("qualquer coisa\n", null, "docs/CLAUDE.md"),
        kind: "claudemd",
      }),
    ).toEqual({ hash: sha("qualquer coisa\n") });
  });

  test("nada escrito fora do projeto nem no ~/.claude: só leitura, .., caminho absoluto, tipo trocado e pasta ligada para fora", async () => {
    const { config, project, claudeDir } = setup();
    const user = fingerprint(claudeDir);
    const outside = tempDir("fd-fora-");
    const attempt = (kind: "claudemd" | "agent" | "skill", path: string, origin?: "user") =>
      code(() =>
        config.write(project, {
          ...write("# x\n", null, path),
          kind,
          ...(origin ? { origin } : {}),
        }),
      );
    expect(await attempt("claudemd", "CLAUDE.md", "user")).toBe("invalid_state");
    expect(await attempt("claudemd", "../fora/CLAUDE.md")).toBe("bad_request");
    expect(await attempt("claudemd", join(outside, "CLAUDE.md"))).toBe("bad_request");
    expect(await attempt("agent", "CLAUDE.md")).toBe("bad_request");
    expect(await attempt("agent", ".claude/agents/sub/x.md")).toBe("bad_request");
    expect(await attempt("skill", ".claude/skills/SKILL.md")).toBe("bad_request");
    expect(await attempt("claudemd", "LEIAME.md")).toBe("bad_request");
    symlinkSync(
      outside,
      join(project, "ligada"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(await attempt("claudemd", "ligada/CLAUDE.md")).toBe("bad_request");
    expect(existsSync(join(outside, "CLAUDE.md"))).toBe(false);
    expect(fingerprint(claudeDir)).toEqual(user);
  });

  test("protocolo: agentcfg.list, read e write por projeto", async () => {
    const { board, manager, repo } = newBoard();
    const { id: projectId } = await board.addProject({ path: repo });
    put(repo, ".claude/agents/revisor.md", AGENT);
    const server = startServer({
      manager,
      board,
      agentcfg: new AgentConfig({ claudeDir: tempDir() }),
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const listed = await client.data<{ items: Array<{ path: string }> }>("agentcfg.list", {
      projectId,
      kind: "agent",
    });
    expect(listed?.items.map((i) => i.path)).toEqual([".claude/agents/revisor.md"]);
    const path = ".claude/agents/revisor.md";
    const read = await client.data<{ content: string; hash: string }>("agentcfg.read", {
      projectId,
      kind: "agent",
      path,
    });
    expect(read).toMatchObject({ content: AGENT, hash: sha(AGENT) });
    const edited = AGENT.replace("Revise.", "Revise de novo.");
    const payload = { projectId, kind: "agent", path, content: edited, expectedHash: sha(AGENT) };
    expect(await client.request("agentcfg.write", payload)).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
    expect(await client.data("agentcfg.write", { ...payload, confirm: true })).toEqual({
      hash: sha(edited),
    });
  });

  test("protocolo: daemon sem a config de agente responde invalid_state", async () => {
    const { board, manager, repo } = newBoard();
    const { id: projectId } = await board.addProject({ path: repo });
    const server = startServer({
      manager,
      board,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    expect(await client.request("agentcfg.list", { projectId, kind: "agent" })).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
  });
});
