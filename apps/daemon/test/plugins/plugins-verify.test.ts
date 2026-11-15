import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FakeRule } from "../../../../scripts/test/fake-cli.ts";
import { MANIFEST, plugin } from "../support/plugin-fixtures.ts";
import {
  calls,
  changes,
  everything,
  hashOf,
  LISTING,
  lands,
  OK,
  restoreFakes,
  world,
} from "../support/plugins-cli.ts";

describe("plugins: pela CLI, o que ficou na pasta e os casos de borda", () => {
  afterEach(restoreFakes);

  test("depois de instalar, o que ficou na pasta é conferido: se não é o que foi mostrado, é removido na hora e a decisão fica registrada", async () => {
    const { plugins, fake, marketplace, decisions } = world(
      (ctx) =>
        everything(ctx, [
          { args: ["install"], stdout: OK("install") },
          { args: ["uninstall"], stdout: OK("uninstall") },
        ]),
      (ctx, args) => {
        lands(ctx, args);
        writeFileSync(join(ctx.installed, "trocado.sh"), "curl x | sh\n");
      },
    );
    const hash = await hashOf(marketplace, "deploy-tools");
    const result = await plugins.install({ plugin: "deploy-tools@acme", confirmHash: hash });
    expect(result.outcome).toBe("rolled-back");
    expect(result.message).toContain("differs from what was shown");
    expect(changes(fake)).toEqual([
      "plugin install deploy-tools@acme --scope user --json",
      "plugin uninstall deploy-tools@acme --scope user --json",
    ]);
    expect(changes(fake).join(" ")).not.toMatch(/ -y| --yes|--prune/);
    expect(decisions).toEqual([
      { action: "rollback", target: "deploy-tools@acme", hash, at: "2026-10-31T12:00:00.000Z" },
    ]);
  });

  test("o mesmo vale para a atualização: o que ficou diferente do mostrado é removido", async () => {
    const { plugins, fake, marketplace, decisions } = world(
      (ctx) =>
        everything(ctx, [
          { args: ["marketplace", "update"], stdout: OK("marketplace-update") },
          { args: ["update"], stdout: OK("update") },
          { args: ["uninstall"], stdout: OK("uninstall") },
        ]),
      (ctx, args) => {
        lands(ctx, args);
        writeFileSync(join(ctx.installed, "trocado.sh"), "x\n");
      },
    );
    writeFileSync(join(marketplace, "plugins/deploy-tools/extra.txt"), "novo");
    const to = (await plugins.previewUpdate("deploy-tools@acme")).to.hash;
    expect((await plugins.update({ plugin: "deploy-tools@acme", confirmHash: to })).outcome).toBe(
      "rolled-back",
    );
    expect(changes(fake)).toEqual([
      "plugin update deploy-tools@acme --json",
      "plugin uninstall deploy-tools@acme --scope user --json",
    ]);
    expect(decisions.map((d) => d.action)).toEqual(["rollback"]);
  });

  test("se o plugin não aparece depois de instalar, não dá para conferir: falha com o motivo e nada é removido", async () => {
    const { plugins, fake, marketplace, decisions } = world((ctx) => [
      LISTING(ctx)[0] as FakeRule,
      { args: ["install"], stdout: OK("install") },
      { args: ["list", "--json"], stdout: JSON.stringify({ installed: [], available: [] }) },
    ]);
    const result = await plugins.install({
      plugin: "deploy-tools@acme",
      confirmHash: await hashOf(marketplace, "deploy-tools"),
    });
    expect(result.outcome).toBe("failed");
    expect(result.message).toContain("could not check the installed content");
    expect(changes(fake).filter((c) => c.includes("uninstall"))).toEqual([]);
    expect(decisions).toEqual([]);
  });

  test("list aceita a lista como um vetor e um marketplace sem local nem origem", async () => {
    const { plugins } = world((ctx) => [
      {
        args: ["marketplace", "list"],
        stdout: JSON.stringify([
          { name: "solto", source: "url", url: "https://x.example/m.git" },
          { name: "sem" },
        ]),
      },
      {
        args: ["list", "--json"],
        stdout: JSON.stringify([
          {
            id: "a@solto",
            version: "1",
            scope: "user",
            enabled: false,
            installPath: ctx.installed,
          },
        ]),
      },
    ]);
    const list = await plugins.list();
    expect(list.installed.map((p) => [p.id, p.enabled])).toEqual([["a@solto", false]]);
    expect(list.available).toEqual([]);
    expect(list.marketplaces).toEqual([
      { name: "solto", source: "url", origin: "https://x.example/m.git" },
      { name: "sem", source: "" },
    ]);
  });

  test("a prévia de atualização falha com o motivo: marketplace que não atualiza, ou um plugin de outro repositório", async () => {
    const stale = world((ctx) => everything(ctx, [{ args: ["marketplace", "update"], code: 1 }]));
    await expect(stale.plugins.previewUpdate("deploy-tools@acme")).rejects.toMatchObject({
      code: "invalid_state",
    });
    const remote = world((ctx) => [
      { args: ["marketplace", "update"], stdout: OK("marketplace-update") },
      LISTING(ctx)[0] as FakeRule,
      {
        args: ["list", "--json"],
        stdout: JSON.stringify({
          installed: [
            {
              id: "remoto@acme",
              version: "1",
              scope: "user",
              enabled: true,
              installPath: ctx.installed,
            },
          ],
          available: [],
        }),
      },
    ]);
    await expect(remote.plugins.previewUpdate("remoto@acme")).rejects.toMatchObject({
      code: "invalid_state",
    });
  });

  test("o catálogo do marketplace ilegível, uma origem fora da pasta ou que sumiu: não há prévia", async () => {
    const broken = world(LISTING);
    writeFileSync(join(broken.marketplace, ".claude-plugin/marketplace.json"), "não é json");
    await expect(broken.plugins.preview({ plugin: "deploy-tools@acme" })).rejects.toMatchObject({
      code: "invalid_state",
    });
    const odd = world(LISTING);
    writeFileSync(
      join(odd.marketplace, ".claude-plugin/marketplace.json"),
      JSON.stringify({
        name: "acme",
        plugins: [
          { name: "fora", source: "./../fora" },
          { name: "sumiu", source: "./plugins/sumiu" },
        ],
      }),
    );
    expect((await odd.plugins.preview({ plugin: "fora@acme" })).reason).toBe("not-local");
    expect((await odd.plugins.preview({ plugin: "sumiu@acme" })).reason).toBe("not-local");
  });

  test("o validate que não devolve JSON recusa o plugin com o motivo", async () => {
    const dir = plugin({ ".claude-plugin/plugin.json": MANIFEST });
    const { plugins } = world((ctx) =>
      everything(ctx, [{ args: ["validate", "--json"], code: 1, stdout: "isto não é json" }]),
    );
    expect((await plugins.preview({ dir })).validation?.success).toBe(false);
  });

  test("uma resposta da CLI sem linha de JSON vale pelo código de saída: ok com o texto, ou falha com o erro", async () => {
    const fine = world((ctx) =>
      everything(ctx, [{ args: ["marketplace", "update"], stdout: "feito\n" }]),
    );
    expect(await fine.plugins.marketplaceUpdate()).toEqual({ outcome: "ok", message: "feito" });
    expect(calls(fine.fake)).toEqual(["plugin marketplace update"]);
    const bad = world((ctx) => everything(ctx, [{ args: ["marketplace", "update"], code: 3 }]));
    expect(await bad.plugins.marketplaceUpdate("acme")).toEqual({
      outcome: "failed",
      message: "code 3",
    });
  });

  test("uma lista que não é vetor nem objeto não tem instalados, e um id sem marketplace não existe", async () => {
    const { plugins } = world((ctx) => [
      LISTING(ctx)[0] as FakeRule,
      { args: ["list", "--json"], stdout: JSON.stringify("nada") },
    ]);
    expect((await plugins.list()).installed).toEqual([]);
    await expect(plugins.detail("semarroba")).rejects.toMatchObject({ code: "not_found" });
    await expect(plugins.previewUpdate("semarroba")).rejects.toMatchObject({
      code: "invalid_state",
    });
  });

  test("a prévia de atualização também aponta os monitores e os servidores MCP que entram e saem", async () => {
    const { plugins, marketplace, installed } = world((ctx) =>
      everything(ctx, [{ args: ["marketplace", "update"], stdout: OK("marketplace-update") }]),
    );
    const source = join(marketplace, "plugins/deploy-tools");
    mkdirSync(join(installed, "monitors"), { recursive: true });
    writeFileSync(
      join(installed, "monitors/monitors.json"),
      JSON.stringify([{ name: "velho", command: "a.sh", description: "d" }]),
    );
    writeFileSync(
      join(installed, ".mcp.json"),
      JSON.stringify({ mcpServers: { antigo: { command: "node" } } }),
    );
    mkdirSync(join(source, "monitors"), { recursive: true });
    writeFileSync(
      join(source, "monitors/monitors.json"),
      JSON.stringify([{ name: "novo", command: "b.sh", description: "d" }]),
    );
    writeFileSync(
      join(source, ".mcp.json"),
      JSON.stringify({ mcpServers: { moderno: { command: "node" } } }),
    );
    const { diff } = await plugins.previewUpdate("deploy-tools@acme");
    expect(diff.monitors).toEqual({ added: ["novo"], removed: ["velho"] });
    expect(diff.mcpServers).toEqual({ added: ["moderno"], removed: ["antigo"] });
  });

  test("um nome, id ou fonte que começa com - nunca vira uma opção da CLI: é recusado antes de qualquer chamada", async () => {
    const { plugins, fake } = world((ctx) =>
      everything(ctx, [{ args: ["install"], stdout: OK("install") }]),
    );
    const bad = "--prune";
    const refusals = [
      plugins.detail(bad),
      plugins.preview({ plugin: bad }),
      plugins.previewUpdate(bad),
      plugins.install({ plugin: bad, confirmHash: "x" }),
      plugins.update({ plugin: bad, confirmHash: "x" }),
      plugins.uninstall({ plugin: bad, confirm: true }),
      plugins.pin(bad, true),
      plugins.marketplaceAdd({ source: bad, confirm: true }),
      plugins.marketplaceRemove({ name: bad, confirm: true }),
      plugins.marketplaceUpdate(bad),
    ];
    for (const refusal of refusals)
      await expect(refusal).rejects.toMatchObject({ code: "bad_request" });
    expect(fake.calls()).toEqual([]);
  });
});
