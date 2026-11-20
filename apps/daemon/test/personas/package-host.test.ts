import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Persona } from "@flightdeck/protocol";
import type { Personas } from "../../src/personas/store.ts";
import { startServer } from "../../src/server.ts";
import { newManager, workspace } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { edit, SPEC_IDS, setup } from "./package-setup.ts";

const TOKEN = "personas-pack-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function codeOf(fn: () => unknown): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
}

describe("personas-pacote: no daemon", () => {
  test("aparecem na lista do host, no idioma pedido (pt-BR quando não se pede), confiáveis e sem edição", async () => {
    const { personas } = setup();
    const listed = (await personas.list({ scope: "host" })).personas;
    expect(listed.map((p) => p.id)).toEqual(SPEC_IDS);
    expect(listed[0]).toMatchObject({
      scope: "pack",
      trusted: true,
      modified: false,
      hash: null,
      name: "Arquiteto",
    });
    expect(
      (await personas.list({ scope: "host", language: "en" })).personas.map((p) => p.name),
    ).toContain("Security reviewer");
    expect((await personas.get("security", {})).name).toBe("Revisor de segurança");
    expect((await personas.get("security", { language: "en" })).name).toBe("Security reviewer");
    expect((await personas.resolve({ id: "qa" }, { language: "en" })).persona.body).toMatch(
      /You act as a senior QA engineer/,
    );
    expect(await personas.resolve({ id: "qa" }, {})).toMatchObject({ source: "pack", hash: null });
  });

  test("editar guarda a versão do host no lugar da do pacote, nos dois idiomas; restaurar volta ao original", async () => {
    const { personas } = setup();
    const saved = await personas.save({
      scope: "host",
      persona: edit("reviewer", "Revise só o que mudou."),
    });
    expect(saved).toMatchObject({ id: "reviewer", scope: "host", modified: true });
    const revisor = async (language?: "pt-BR" | "en") =>
      (await personas.list({ scope: "host", ...(language ? { language } : {}) })).personas.filter(
        (p) => p.id === "reviewer",
      );
    // One entry per id: the edited one stands in for the pack's, whatever the language.
    expect((await revisor()).map((p) => p.body)).toEqual(["Revise só o que mudou."]);
    expect((await revisor("en")).map((p) => p.body)).toEqual(["Revise só o que mudou."]);
    expect((await personas.list({ scope: "host" })).personas).toHaveLength(14);
    expect((await personas.resolve({ id: "reviewer" }, {})).persona.body).toBe(
      "Revise só o que mudou.",
    );
    const restored = personas.reset("reviewer", {});
    expect(restored).toMatchObject({
      id: "reviewer",
      scope: "pack",
      modified: false,
      name: "Revisor de código",
    });
    expect((await personas.get("reviewer", { language: "en" })).name).toBe("Code reviewer");
    // Resetting what is not edited is fine; what is not in the pack has nothing to go back to.
    expect(personas.reset("reviewer", {}).scope).toBe("pack");
    await personas.save({ scope: "host", persona: edit("minha", "Uma minha.") });
    expect(await codeOf(() => personas.reset("minha", {}))).toBe("bad_request");
    expect((await personas.get("minha", {})).scope).toBe("host");
  });

  test("uma do pacote não se remove; a editada se remove restaurando, e uma que só o host tem se remove de vez", async () => {
    const { personas } = setup();
    expect(await codeOf(() => personas.remove("host", "qa"))).toBe("not_found");
    await personas.save({ scope: "host", persona: edit("qa", "Meu QA.") });
    await personas.remove("host", "qa");
    expect((await personas.get("qa", {})).scope).toBe("pack");
    await personas.save({ scope: "host", persona: edit("minha", "Uma minha.") });
    await personas.remove("host", "minha");
    expect((await personas.list({ scope: "host" })).personas).toHaveLength(14);
  });

  test("a edição vale as regras de sempre, e a do projeto vale mais que a editada e que a do pacote", async () => {
    const { personas, project } = setup();
    const secret = `ghp_${"0123456789abcdef".repeat(2)}0123`;
    expect(
      await codeOf(() => personas.save({ scope: "host", persona: edit("qa", `Use ${secret}`) })),
    ).toBe("persona_secret");
    expect((await personas.get("qa", {})).scope).toBe("pack");
    await personas.save({ scope: "host", persona: edit("qa", "Do host.") });
    await personas.save({
      scope: "project",
      projectPath: project,
      persona: edit("qa", "Do projeto."),
    });
    expect((await personas.get("qa", { projectPath: project })).body).toBe("Do projeto.");
    expect((await personas.get("qa", {})).body).toBe("Do host.");
    // A project persona that is not trusted is never used in place of the pack's, it is refused.
    const dir = join(project, ".flightdeck", "personas");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "sre.md"),
      "---\nid: sre\nname: Do projeto\ndescription: d\n---\nCorpo.\n",
    );
    expect(await codeOf(() => personas.resolve({ id: "sre" }, { projectPath: project }))).toBe(
      "persona_untrusted",
    );
  });
});

describe("personas-pacote: pelo protocolo", () => {
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

  test("personas.list com language e personas.reset", async () => {
    const { personas, root } = setup();
    const { client, codeOfCall } = await connect(personas, root);
    const english = await client.data<{ personas: Persona[] }>("personas.list", {
      scope: "host",
      language: "en",
    });
    expect(english?.personas.map((p) => p.name)).toContain("Architect");
    await client.data("personas.save", { scope: "host", persona: edit("sre", "Meu SRE.") });
    expect(await client.data("personas.reset", { id: "sre", language: "en" })).toMatchObject({
      id: "sre",
      scope: "pack",
      name: "SRE / DevOps",
    });
    expect(await codeOfCall("personas.reset", { id: "nada" })).toBe("bad_request");
    expect(await codeOfCall("personas.reset", { id: "sre", language: "fr" })).toBe("bad_request");
    expect(await codeOfCall("personas.list", { language: "fr" })).toBe("bad_request");
  });

  test("sem as personas configuradas, reset diz que está desativado", async () => {
    const { root } = workspace();
    const { codeOfCall } = await connect(null, root);
    expect(await codeOfCall("personas.reset", { id: "qa" })).toBe("invalid_state");
  });
});
