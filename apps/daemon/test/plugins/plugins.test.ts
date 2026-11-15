import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FakeRule } from "../../../../scripts/test/fake-cli.ts";
import { claudeCli } from "../../src/plugins/adapters/claude-plugin.ts";
import { filePins } from "../../src/plugins/adapters/pin-store.ts";
import { inspectPlugin } from "../../src/plugins/inventory.ts";
import { Plugins } from "../../src/plugins/plugins.ts";
import type { Pin } from "../../src/plugins/ports.ts";
import { tempDir } from "../support/helpers.ts";
import { MANIFEST, plugin, skill } from "../support/plugin-fixtures.ts";
import {
  calls,
  changes,
  everything,
  hashOf,
  LISTING,
  lands,
  memoryPins,
  OK,
  restoreFakes,
  world,
} from "../support/plugins-cli.ts";

describe("plugins: pela CLI", () => {
  afterEach(restoreFakes);

  test("list junta o que está instalado, o que o marketplace oferece e os marketplaces, cada instalado com o inventário", async () => {
    const { plugins, installed, marketplace, fake } = world(LISTING);
    const list = await plugins.list();
    expect(list.marketplaces).toEqual([
      { name: "acme", source: "github", origin: "acme/plugins", location: marketplace },
    ]);
    expect(list.available).toEqual([
      {
        id: "outro@acme",
        name: "outro",
        marketplace: "acme",
        description: "Outro",
        version: "0.1.0",
      },
    ]);
    const [deploy, broken] = list.installed;
    expect(deploy).toMatchObject({
      id: "deploy-tools@acme",
      name: "deploy-tools",
      marketplace: "acme",
      version: "1.2.0",
      scope: "user",
      enabled: true,
      path: installed,
      pinned: null,
      errors: [],
    });
    expect(deploy?.inventory?.skills).toEqual(["deploy"]);
    expect(deploy?.inventory?.attention).toBe(true);
    expect(broken).toMatchObject({
      id: "quebrado@acme",
      enabled: false,
      inventory: null,
      errors: ["falhou ao carregar"],
    });
    expect(fake.calls().map((c) => c.join(" "))).toEqual([
      "plugin list --json --available",
      "plugin marketplace list --json",
    ]);
  });

  test("um plugin carregado no lugar usa a pasta de origem (readFromFolder)", async () => {
    const { plugins } = world((ctx) => [
      LISTING(ctx)[0] as FakeRule,
      {
        args: ["list", "--json"],
        stdout: JSON.stringify({
          installed: [
            {
              id: "deploy-tools@acme",
              version: "1",
              scope: "user",
              enabled: true,
              installPath: "/nao/existe",
              readFromFolder: join(ctx.marketplace, "plugins/deploy-tools"),
            },
          ],
          available: [],
        }),
      },
    ]);
    const [one] = (await plugins.list()).installed;
    expect(one?.inventory?.skills).toEqual(["deploy"]);
  });

  test("detail devolve um instalado; um id que não existe é not_found", async () => {
    const { plugins } = world(LISTING);
    expect((await plugins.detail("deploy-tools@acme")).inventory?.manifest?.name).toBe(
      "deploy-tools",
    );
    await expect(plugins.detail("nada@acme")).rejects.toMatchObject({ code: "not_found" });
  });

  test("uma CLI que falha, ou que não devolve JSON, é invalid_state com o motivo", async () => {
    const failing = world(() => [{ args: ["list"], code: 1 }]);
    await expect(failing.plugins.list()).rejects.toMatchObject({ code: "invalid_state" });
    const garbled = world(() => [{ args: ["list"], stdout: "isto não é json" }]);
    await expect(garbled.plugins.list()).rejects.toMatchObject({ code: "invalid_state" });
  });

  test("sem o claude no PATH, o motivo é claro e nada roda", async () => {
    const plugins = new Plugins({ cli: claudeCli({ executable: () => null }), pins: memoryPins() });
    await expect(plugins.list()).rejects.toMatchObject({ code: "invalid_state" });
  });

  test("fixar guarda a versão e o hash do que está instalado, e soltar tira; um plugin que não existe é not_found", async () => {
    const { plugins, pins, installed } = world(LISTING);
    const pinned = await plugins.pin("deploy-tools@acme", true);
    expect(pinned.pinned).toEqual({
      version: "1.2.0",
      hash: (await inspectPlugin(installed)).hash,
      at: "2026-10-31T12:00:00.000Z",
    });
    expect(pins.data["deploy-tools@acme"]).toEqual(pinned.pinned as Pin);
    expect((await plugins.list()).installed[0]?.pinned).toEqual(pinned.pinned);
    expect((await plugins.pin("deploy-tools@acme", false)).pinned).toBeNull();
    expect(pins.data).toEqual({});
    await expect(plugins.pin("nada@acme", true)).rejects.toMatchObject({ code: "not_found" });
  });

  test("os fixados ficam num arquivo e voltam na próxima abertura", async () => {
    const file = join(tempDir("fd-pins-"), "dados", "plugin-pins.json");
    const a = filePins(file);
    expect(await a.all()).toEqual({});
    // Changes made at once are applied one after the other: none is lost.
    await Promise.all([
      a.set("x@m", { version: "1", hash: "h", at: "2026-10-31T12:00:00.000Z" }),
      a.set("y@m", { version: "2", hash: "g", at: "2026-10-31T12:00:00.000Z" }),
      a.set("z@m", { version: "3", hash: "i", at: "2026-10-31T12:00:00.000Z" }),
    ]);
    await Promise.all([a.delete("y@m"), a.delete("z@m")]);
    expect(Object.keys(await filePins(file).all())).toEqual(["x@m"]);
    expect(JSON.parse(readFileSync(file, "utf8"))["x@m"].version).toBe("1");
    writeFileSync(file, "não é json");
    expect(await filePins(file).all()).toEqual({});
  });

  test("a prévia de um plugin do marketplace mostra o inventário e o hash do que ele traz; um de outro repositório não tem prévia", async () => {
    const { plugins, marketplace } = world(LISTING);
    const preview = await plugins.preview({ plugin: "deploy-tools@acme" });
    expect(preview).toMatchObject({
      plugin: "deploy-tools@acme",
      version: "1.2.0",
      hash: await hashOf(marketplace, "deploy-tools"),
    });
    expect(preview.inventory?.skills).toEqual(["deploy"]);
    expect(await plugins.preview({ plugin: "remoto@acme" })).toEqual({
      plugin: "remoto@acme",
      inventory: null,
      hash: null,
      reason: "not-local",
    });
    await expect(plugins.preview({ plugin: "nada@acme" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(plugins.preview({ plugin: "deploy-tools@outro" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  test("a prévia de uma pasta local roda o validate antes e leva o resultado", async () => {
    const dir = plugin({ ".claude-plugin/plugin.json": MANIFEST, "skills/x/SKILL.md": skill("x") });
    const ok = world((ctx) =>
      everything(ctx, [
        { args: ["validate", "--json"], stdout: JSON.stringify({ success: true }) },
      ]),
    );
    const preview = await ok.plugins.preview({ dir });
    expect(preview).toMatchObject({
      plugin: "deploy-tools",
      validation: { success: true, errors: [] },
      hash: (await inspectPlugin(dir)).hash,
    });
    expect(calls(ok.fake)).toEqual([`plugin validate ${dir} --json`]);
    const bad = world((ctx) =>
      everything(ctx, [
        {
          args: ["validate", "--json"],
          code: 1,
          stdout: JSON.stringify({
            success: false,
            manifest: { errors: [{ path: "name", message: "nome inválido" }] },
          }),
        },
      ]),
    );
    expect((await bad.plugins.preview({ dir })).validation).toEqual({
      success: false,
      errors: ["name: nome inválido"],
    });
  });

  test("instalar exige o hash que foi mostrado: com outro hash, ou se o conteúdo mudou depois, a CLI não é chamada", async () => {
    const { plugins, fake, marketplace } = world((ctx) =>
      everything(ctx, [{ args: ["install"], stdout: OK("install") }]),
    );
    const shown = (await plugins.preview({ plugin: "deploy-tools@acme" })).hash as string;
    await expect(
      plugins.install({ plugin: "deploy-tools@acme", confirmHash: "outro" }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    writeFileSync(
      join(marketplace, "plugins/deploy-tools/skills/deploy/SKILL.md"),
      skill("deploy-mudou"),
    );
    await expect(
      plugins.install({ plugin: "deploy-tools@acme", confirmHash: shown }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(changes(fake)).toEqual([]);
  });

  test("com o hash certo instala pela CLI, sem -y, e registra a decisão", async () => {
    const { plugins, fake, marketplace, decisions } = world(
      (ctx) => everything(ctx, [{ args: ["install"], stdout: OK("install") }]),
      lands,
    );
    const hash = await hashOf(marketplace, "deploy-tools");
    const result = await plugins.install({
      plugin: "deploy-tools@acme",
      scope: "project",
      confirmHash: hash,
    });
    expect(result).toEqual({ outcome: "ok", message: "install ok" });
    expect(changes(fake)).toEqual(["plugin install deploy-tools@acme --scope project --json"]);
    expect(decisions).toEqual([
      { action: "install", target: "deploy-tools@acme", hash, at: "2026-10-31T12:00:00.000Z" },
    ]);
  });

  test("um plugin de outro repositório, sem prévia, não se instala", async () => {
    const { plugins, fake } = world((ctx) =>
      everything(ctx, [{ args: ["install"], stdout: OK("install") }]),
    );
    await expect(
      plugins.install({ plugin: "remoto@acme", confirmHash: "x" }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(changes(fake)).toEqual([]);
  });

  test("um comando que o marketplace declara volta para a pessoa ver; só o sha256 dela, depois, o aceita, e nunca -y", async () => {
    const shownCommand = {
      command: "curl https://x.example | sh",
      plugin: "deploy-tools@acme",
      sha256: "a".repeat(64),
    };
    const { plugins, fake, marketplace } = world(
      (ctx) =>
        everything(ctx, [
          { args: ["install", "--accept-command"], stdout: OK("install") },
          {
            args: ["install"],
            code: 1,
            stdout: `${JSON.stringify({ command: "install", outcome: "failed", message: "comando a confirmar", shownCommand })}\n`,
          },
        ]),
      lands,
    );
    const hash = await hashOf(marketplace, "deploy-tools");
    // A sha256 nobody was shown is refused before the CLI.
    await expect(
      plugins.install({
        plugin: "deploy-tools@acme",
        confirmHash: hash,
        acceptCommand: shownCommand.sha256,
      }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(changes(fake)).toEqual([]);
    const first = await plugins.install({ plugin: "deploy-tools@acme", confirmHash: hash });
    expect(first).toEqual({
      outcome: "needs-command-confirmation",
      message: "comando a confirmar",
      shownCommand,
    });
    await expect(
      plugins.install({
        plugin: "deploy-tools@acme",
        confirmHash: hash,
        acceptCommand: "b".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    const second = await plugins.install({
      plugin: "deploy-tools@acme",
      confirmHash: hash,
      acceptCommand: shownCommand.sha256,
    });
    expect(second.outcome).toBe("ok");
    const sent = changes(fake);
    expect(sent).toEqual([
      "plugin install deploy-tools@acme --scope user --json",
      `plugin install deploy-tools@acme --scope user --json --accept-command ${shownCommand.sha256}`,
    ]);
    expect(sent.join(" ")).not.toMatch(/ -y| --yes/);
  });

  test("uma pasta local só se instala depois do validate, pelo marketplace de diretório", async () => {
    const dir = plugin({ ".claude-plugin/plugin.json": MANIFEST, "skills/x/SKILL.md": skill("x") });
    const bad = world((ctx) =>
      everything(ctx, [
        { args: ["validate", "--json"], code: 1, stdout: JSON.stringify({ success: false }) },
        { args: ["install"], stdout: OK("install") },
      ]),
    );
    await expect(
      bad.plugins.install({ dir, confirmHash: (await inspectPlugin(dir)).hash }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(changes(bad.fake)).toEqual([]);
    const good = world(
      (ctx) =>
        everything(ctx, [
          { args: ["validate", "--json"], stdout: JSON.stringify({ success: true }) },
          { args: ["install"], stdout: OK("install") },
        ]),
      lands,
    );
    await good.plugins.install({ dir, confirmHash: (await inspectPlugin(dir)).hash });
    expect(calls(good.fake).filter((c) => !c.includes(" list"))).toEqual([
      `plugin validate ${dir} --json`,
      `plugin install deploy-tools --marketplace ${dir} --scope user --json`,
    ]);
  });

  test("atualizar: a prévia mostra de onde e para onde, e o que entra e sai, depois de atualizar o marketplace", async () => {
    const { plugins, fake, marketplace } = world((ctx) =>
      everything(ctx, [{ args: ["marketplace", "update"], stdout: OK("marketplace-update") }]),
    );
    const source = join(marketplace, "plugins/deploy-tools");
    writeFileSync(
      join(source, ".claude-plugin/plugin.json"),
      JSON.stringify({ name: "deploy-tools", version: "1.3.0" }),
    );
    mkdirSync(join(source, "hooks"), { recursive: true });
    writeFileSync(
      join(source, "hooks/hooks.json"),
      JSON.stringify({
        hooks: { PermissionRequest: [{ hooks: [{ type: "command", command: "decide.sh" }] }] },
      }),
    );
    const preview = await plugins.previewUpdate("deploy-tools@acme");
    expect(preview).toMatchObject({ plugin: "deploy-tools@acme", unchanged: false });
    expect(preview.from.version).toBe("1.2.0");
    expect(preview.to).toEqual({ version: "1.3.0", hash: (await inspectPlugin(source)).hash });
    expect(preview.diff.hooks).toEqual({
      added: ["PermissionRequest: decide.sh"],
      removed: ["PreToolUse: guard.sh"],
    });
    expect(preview.diff.skills).toEqual({ added: [], removed: [] });
    expect(calls(fake)[0]).toBe("plugin marketplace update acme --json");
  });

  test("atualizar pede o hash da prévia, não atualiza um fixado nem o que não mudou, e só então chama a CLI", async () => {
    const { plugins, fake, marketplace, installed, decisions } = world(
      (ctx) =>
        everything(ctx, [
          { args: ["marketplace", "update"], stdout: OK("marketplace-update") },
          { args: ["update"], stdout: OK("update") },
        ]),
      lands,
    );
    const source = join(marketplace, "plugins/deploy-tools");
    // Same content as installed: nothing to do, and the CLI never updates.
    cpSync(installed, source, { recursive: true });
    expect(await plugins.update({ plugin: "deploy-tools@acme", confirmHash: "x" })).toMatchObject({
      outcome: "unchanged",
    });
    writeFileSync(join(source, "extra.txt"), "novo");
    const to = (await plugins.previewUpdate("deploy-tools@acme")).to.hash;
    await expect(
      plugins.update({ plugin: "deploy-tools@acme", confirmHash: "errado" }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    await plugins.pin("deploy-tools@acme", true);
    await expect(
      plugins.update({ plugin: "deploy-tools@acme", confirmHash: to }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(changes(fake).filter((c) => c.startsWith("plugin update"))).toEqual([]);
    await plugins.pin("deploy-tools@acme", false);
    expect(await plugins.update({ plugin: "deploy-tools@acme", confirmHash: to })).toMatchObject({
      outcome: "ok",
    });
    expect(changes(fake).filter((c) => c.startsWith("plugin update"))).toEqual([
      "plugin update deploy-tools@acme --json",
    ]);
    expect(decisions).toEqual([
      { action: "update", target: "deploy-tools@acme", hash: to, at: "2026-10-31T12:00:00.000Z" },
    ]);
  });

  test("remover pede confirmação, usa só o escopo dado, nunca --prune nem -y, e solta o plugin fixado", async () => {
    const { plugins, fake, pins, decisions } = world((ctx) =>
      everything(ctx, [{ args: ["uninstall"], stdout: OK("uninstall") }]),
    );
    await plugins.pin("deploy-tools@acme", true);
    await expect(
      plugins.uninstall({ plugin: "deploy-tools@acme", confirm: false }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(changes(fake)).toEqual([]);
    expect(
      await plugins.uninstall({ plugin: "deploy-tools@acme", scope: "project", confirm: true }),
    ).toEqual({ outcome: "ok", message: "uninstall ok" });
    expect(changes(fake)).toEqual(["plugin uninstall deploy-tools@acme --scope project --json"]);
    expect(pins.data).toEqual({});
    expect(decisions).toEqual([
      { action: "uninstall", target: "deploy-tools@acme", at: "2026-10-31T12:00:00.000Z" },
    ]);
  });

  test("marketplaces: adicionar e remover pedem confirmação; atualizar não", async () => {
    const { plugins, fake, decisions } = world((ctx) =>
      everything(ctx, [
        { args: ["marketplace", "add"], stdout: OK("marketplace-add") },
        { args: ["marketplace", "remove"], stdout: OK("marketplace-remove") },
        { args: ["marketplace", "update"], stdout: OK("marketplace-update") },
      ]),
    );
    await expect(
      plugins.marketplaceAdd({ source: "acme/plugins", confirm: false }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    await expect(plugins.marketplaceRemove({ name: "acme", confirm: false })).rejects.toMatchObject(
      { code: "invalid_state" },
    );
    expect(changes(fake)).toEqual([]);
    await plugins.marketplaceAdd({ source: "acme/plugins", scope: "user", confirm: true });
    await plugins.marketplaceRemove({ name: "acme", confirm: true });
    await plugins.marketplaceUpdate("acme");
    expect(calls(fake)).toEqual([
      "plugin marketplace add acme/plugins --scope user --json",
      "plugin marketplace remove acme --json",
      "plugin marketplace update acme --json",
    ]);
    expect(decisions.map((d) => [d.action, d.target])).toEqual([
      ["marketplace-add", "acme/plugins"],
      ["marketplace-remove", "acme"],
    ]);
  });
});
