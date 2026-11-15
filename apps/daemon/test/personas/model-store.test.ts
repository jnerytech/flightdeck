import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Persona } from "@flightdeck/protocol";
import { normalizePersona, parsePersona, personaHash } from "../../src/personas/domain/model.ts";
import { Personas } from "../../src/personas/store.ts";
import { startServer } from "../../src/server.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { BASELINE_FEATURES, newManager, workspace } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { codeOf, input, SECURITY, scanner } from "./model-setup.ts";

const TOKEN = "personas-token-0123456789abcdef0123";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function setup() {
  const { root, project } = workspace();
  const clock = Date.parse("2026-10-29T12:00:00Z");
  const store = new EventStore(":memory:");
  const personas = new Personas({ db: store.db, allowedRoots: [root], scanner, now: () => clock });
  const dir = join(project, ".flightdeck", "personas");
  const writeFile = (id: string, source: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.md`), source);
  };
  return { root, project, personas, dir, writeFile };
}

describe("personas-modelo: do host", () => {
  test("salvar, listar, buscar, atualizar e remover; salvar com o mesmo id atualiza", async () => {
    const { personas } = setup();
    const saved = await personas.save({ scope: "host", persona: input() });
    expect(saved).toMatchObject({
      id: "revisor",
      scope: "host",
      trusted: true,
      hash: null,
    });
    expect((await personas.list({ scope: "host" })).personas.map((p) => p.id)).toEqual(["revisor"]);
    expect((await personas.get("revisor", {})).body).toBe("Revise o código com cuidado.");
    expect(
      (await personas.save({ scope: "host", persona: input({ body: "Outro corpo." }) })).body,
    ).toBe("Outro corpo.");
    expect((await personas.list({ scope: "host" })).personas).toHaveLength(1);
    await personas.remove("host", "revisor");
    expect((await personas.list({ scope: "host" })).personas).toEqual([]);
    expect(await codeOf(() => personas.get("revisor", {}))).toBe("not_found");
    expect(await codeOf(() => personas.remove("host", "revisor"))).toBe("not_found");
    expect(
      await codeOf(() =>
        personas.save({
          scope: "host",
          persona: input({ body: "ghp_0123456789abcdef0123456789abcdef0123" }),
        }),
      ),
    ).toBe("persona_secret");
  });
});

describe("personas-modelo: do projeto, versionadas", () => {
  test("carrega os arquivos de .flightdeck/personas, e as ruins ficam de fora com o motivo", async () => {
    const { personas, project, writeFile } = setup();
    expect(await personas.list({ scope: "project", projectPath: project })).toEqual({
      personas: [],
      project: null,
    });
    writeFile("seguranca", SECURITY);
    writeFile("ruim", "sem frontmatter");
    writeFile("outro-nome", SECURITY);
    const listed = await personas.list({ scope: "project", projectPath: project });
    expect(listed.personas.map((p) => p.id)).toEqual(["seguranca"]);
    expect(listed.personas[0]).toMatchObject({
      scope: "project",
      trusted: false,
    });
    expect(listed.personas[0]?.hash).toBe(personaHash(SECURITY));
    expect(listed.project?.errors).toHaveLength(2);
    expect(listed.project?.errors.join("|")).toMatch(/ruim/);
    expect(listed.project?.errors.join("|")).toMatch(/outro-nome/);
    expect(await codeOf(() => personas.list({ scope: "project" }))).toBe("bad_request");
    expect(
      await codeOf(() =>
        personas.list({ scope: "project", projectPath: join(project, "..", "..", "fora") }),
      ),
    ).toBe("forbidden_cwd");
  });

  test("antes do primeiro uso pedem confiança pelo hash; mudar o arquivo tira a confiança", async () => {
    const { personas, project, writeFile } = setup();
    writeFile("seguranca", SECURITY);
    const ctx = { projectPath: project };
    expect(await codeOf(() => personas.resolve({ id: "seguranca" }, ctx))).toBe(
      "persona_untrusted",
    );
    expect(await codeOf(() => personas.trust(project, "seguranca", "0".repeat(64)))).toBe(
      "invalid_state",
    );
    expect(await codeOf(() => personas.trust(project, "nao-existe", personaHash(SECURITY)))).toBe(
      "not_found",
    );
    const trusted = await personas.trust(project, "seguranca", personaHash(SECURITY));
    expect(trusted).toMatchObject({ id: "seguranca", trusted: true });
    expect((await personas.resolve({ id: "seguranca" }, ctx)).persona.name).toBe(
      "Revisor de segurança",
    );
    // Changed: another hash, not trusted anymore. Back to the old text: trusted again.
    writeFile("seguranca", SECURITY.replace("sênior", "sênior e atento"));
    expect(await codeOf(() => personas.resolve({ id: "seguranca" }, ctx))).toBe(
      "persona_untrusted",
    );
    writeFile("seguranca", SECURITY);
    expect((await personas.resolve({ id: "seguranca" }, ctx)).persona.id).toBe("seguranca");
  });

  test("salvar no projeto escreve o arquivo com o id no nome, confia no que o próprio app salvou e recusa segredo sem escrever nada", async () => {
    const { personas, project, dir } = setup();
    const saved = await personas.save({
      scope: "project",
      projectPath: project,
      persona: input({ id: "revisor" }),
    });
    expect(saved).toMatchObject({ scope: "project", trusted: true });
    const file = join(dir, "revisor.md");
    expect(parsePersona(readFileSync(file, "utf8"), "revisor").name).toBe("Revisor");
    expect(saved.hash).toBe(personaHash(readFileSync(file, "utf8")));
    const secret = `ghp_${"0123456789abcdef".repeat(2)}0123`;
    expect(
      await codeOf(() =>
        personas.save({
          scope: "project",
          projectPath: project,
          persona: input({ id: "novo", body: secret }),
        }),
      ),
    ).toBe("persona_secret");
    expect(existsSync(join(dir, "novo.md"))).toBe(false);
    expect(await codeOf(() => personas.save({ scope: "project", persona: input() }))).toBe(
      "bad_request",
    );
    await personas.remove("project", "revisor", project);
    expect(existsSync(file)).toBe(false);
    expect(await codeOf(() => personas.remove("project", "revisor", project))).toBe("not_found");
  });

  test("a do projeto vale mais que a do host, e a do host serve onde o projeto não tem", async () => {
    const { personas, project } = setup();
    await personas.save({ scope: "host", persona: input({ body: "Do host." }) });
    await personas.save({ scope: "host", persona: input({ id: "so-host", body: "Só do host." }) });
    await personas.save({
      scope: "project",
      projectPath: project,
      persona: input({ body: "Do projeto." }),
    });
    expect((await personas.get("revisor", { projectPath: project })).body).toBe("Do projeto.");
    expect((await personas.get("revisor", {})).body).toBe("Do host.");
    expect((await personas.get("so-host", { projectPath: project })).body).toBe("Só do host.");
    expect(
      (await personas.list({ projectPath: project })).personas
        .map((p) => `${p.scope}:${p.id}`)
        .sort(),
    ).toEqual(["host:revisor", "host:so-host", "project:revisor"]);
  });

  test("resolver uma definição inline (a persona do app) vale as mesmas regras e não pede confiança", async () => {
    const { personas } = setup();
    const resolved = await personas.resolve(
      { definition: input({ permissionMode: "plan", tools: ["Read"] }) },
      {},
    );
    expect(resolved).toMatchObject({
      persona: { id: "revisor", permissionMode: "plan", tools: ["Read"] },
      source: "inline",
    });
    expect(await codeOf(() => personas.resolve({ definition: input({ body: "" }) }, {}))).toBe(
      "bad_request",
    );
    expect(
      await codeOf(() =>
        personas.resolve({ definition: input({ permissionMode: "bypassPermissions" }) }, {}),
      ),
    ).toBe("bad_request");
    expect(await codeOf(() => personas.resolve({}, {}))).toBe("bad_request");
    for (const definition of ["texto", 42, null, ["lista"]]) {
      expect([definition, await codeOf(() => personas.resolve({ definition }, {}))]).toEqual([
        definition,
        "bad_request",
      ]);
    }
    expect(await codeOf(() => personas.resolve({ id: "nao-existe" }, {}))).toBe("not_found");
  });
});

describe("personas-modelo: pelo protocolo", () => {
  async function connect(personas: Personas | null, root: string) {
    const server = startServer({
      manager: newManager().manager,
      ...(personas ? { personas: { store: personas } } : {}),
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

  test("personas.list, save, remove e trust", async () => {
    const { personas, root, project, writeFile } = setup();
    const { client, codeOfCall } = await connect(personas, root);
    const saved = await client.data<Persona>("personas.save", { scope: "host", persona: input() });
    expect(saved?.id).toBe("revisor");
    expect(await client.data("personas.list", { scope: "host" })).toMatchObject({
      personas: [{ id: "revisor" }],
    });
    writeFile("seguranca", SECURITY);
    const listed = await client.data<{ personas: Array<{ id: string; hash: string }> }>(
      "personas.list",
      { scope: "project", projectPath: project },
    );
    const hash = listed?.personas[0]?.hash ?? "";
    expect(
      await client.data("personas.trust", { projectPath: project, id: "seguranca", hash }),
    ).toMatchObject({ trusted: true });
    expect(await codeOfCall("personas.save", { scope: "host", persona: input({ extra: 1 }) })).toBe(
      "bad_request",
    );
    expect(
      await codeOfCall("personas.save", {
        scope: "host",
        persona: input({ body: "ghp_0123456789abcdef0123456789abcdef0123" }),
      }),
    ).toBe("persona_secret");
    expect(await codeOfCall("personas.remove", { scope: "host", id: "revisor" })).toBe("ok");
    expect(await codeOfCall("personas.remove", { scope: "host", id: "revisor" })).toBe("not_found");
  });

  test("sem as personas configuradas, os comandos dizem que está desativado", async () => {
    const { root } = workspace();
    const { codeOfCall } = await connect(null, root);
    for (const [type, payload] of [
      ["personas.list", {}],
      ["personas.save", { scope: "host", persona: input() }],
      ["personas.remove", { scope: "host", id: "x" }],
      ["personas.trust", { projectPath: "/x", id: "x", hash: "h" }],
    ] as const) {
      expect([type, await codeOfCall(type, payload)]).toEqual([type, "invalid_state"]);
    }
  });

  test("host.info announces personas only when the server keeps them, so the app shows the library there", async () => {
    const featuresOf = async (personas: Personas | null) => {
      const { client } = await connect(personas, setup().root);
      return (
        (await client.data<{ features: string[] }>("host.info", {}))?.features.filter(
          (name) => !BASELINE_FEATURES.includes(name),
        ) ?? []
      );
    };
    expect(await featuresOf(setup().personas)).toContain("personas");
    expect(await featuresOf(null)).not.toContain("personas");
  });
});

describe("personas-modelo: a failure that is not the persona's", () => {
  test("a scanner that breaks surfaces its own error, not a refusal of the persona", () => {
    const broken = {
      scan: (): never => {
        throw new TypeError("the scanner broke");
      },
    };
    let thrown: unknown;
    try {
      normalizePersona({ id: "x", name: "X", description: "d", body: "Oi." }, broken);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as { code?: string }).code).toBeUndefined();
  });
});
