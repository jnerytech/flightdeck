import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertBinaryUntouched,
  installBinaryGuard,
} from "../../../../scripts/test/binary-guard.ts";
import { hookEntries } from "../../src/central/domain/hook-entries.ts";
import { installHooks } from "../../src/central/hooks-install.ts";
import { runCli } from "../../src/main.ts";
import { stableBinPath } from "../../src/service/domain/version.ts";
import { tempDir } from "../support/helpers.ts";

import {
  cleanups,
  DIST_WIN,
  fakeBinary,
  fakeService,
  NEWER,
  previous,
  setup,
  teardown,
  update,
} from "./update-setup.ts";

afterEach(teardown);

describe("update: CLI, hooks and binary guard", () => {
  test("CLI sem --config: usa a config do serviço para o /health", async () => {
    const hits: string[] = [];
    const daemon = Bun.serve({
      port: 0,
      fetch: (req) => {
        hits.push(new URL(req.url).pathname);
        return Response.json({ ok: true });
      },
    });
    cleanups.push(() => daemon.stop(true));
    const config = join(tempDir(), "config.json");
    writeFileSync(
      config,
      JSON.stringify({ token: "t".repeat(32), dataDir: tempDir(), port: daemon.port }),
    );
    const service = fakeService("win32", DIST_WIN, config);
    let code = null as number | null;
    await runCli(["update", "--from", fakeBinary(NEWER)], {
      env: {},
      log: { log: () => {}, error: () => {} },
      exit: (c) => {
        code = c;
      },
      onSignal: () => {},
      serviceContext: () => service.ctx,
    });
    expect(code).toBe(0);
    // First the daemon.shutdown attempt on the WebSocket, then the health check.
    expect(hits).toEqual(["/v1/ws", "/health"]);
  }, 40_000);

  test("hooks instalados fora do caminho estável são reinstalados; sem hooks, nada é escrito", async () => {
    const withHooks = setup("win32", DIST_WIN);
    const target = {
      command: [DIST_WIN],
      url: "http://127.0.0.1:7421",
      token: "h".repeat(20),
      permissionTimeoutS: 600,
      platform: "win32" as const,
    };
    await installHooks(withHooks.settingsPath, target);
    expect(await update(withHooks.deps, fakeBinary("0.8.0"))).toBe(0);
    const settings = JSON.parse(readFileSync(withHooks.settingsPath, "utf8"));
    expect(settings.hooks.SessionStart).toEqual(
      hookEntries({ ...target, command: [withHooks.stable] }).SessionStart,
    );
    expect(withHooks.out.join("\n")).toContain(
      `hooks reinstalados apontando para ${withHooks.stable}`,
    );
    // Already on the stable path: left alone.
    const before = readFileSync(withHooks.settingsPath, "utf8");
    withHooks.out.length = 0;
    expect(await update(withHooks.deps, fakeBinary("0.9.0"))).toBe(0);
    expect(readFileSync(withHooks.settingsPath, "utf8")).toBe(before);
    expect(withHooks.out.join("\n")).not.toContain("hooks reinstalados");
    const without = setup("win32", DIST_WIN);
    expect(await update(without.deps, fakeBinary("0.8.0"))).toBe(0);
    expect(existsSync(without.settingsPath)).toBe(false);
  });

  test("sem serviço e sem daemon: só instala o binário e diz como subir", async () => {
    const { deps, out, calls, stable, healthChecks } = setup("win32", null);
    expect(await update(deps, fakeBinary("0.8.0"))).toBe(0);
    expect(existsSync(stable)).toBe(true);
    expect(calls.map((c) => c[1])).toEqual(["/Query"]);
    expect(healthChecks).toEqual([]);
    expect(out.join("\n")).toContain("nenhum serviço instalado");
  });

  test("CLI: flightdeckd update --from instala no ~/.flightdeck/bin do contexto de serviço", async () => {
    const service = fakeService("win32", null);
    const config = join(tempDir(), "config.json");
    writeFileSync(config, JSON.stringify({ token: "t".repeat(32), dataDir: tempDir() }));
    const run = async (args: string[]) => {
      const out: string[] = [];
      let code = null as number | null;
      await runCli(args, {
        env: {},
        log: { log: (m) => out.push(m), error: (m) => out.push(m) },
        exit: (c) => {
          code = c;
        },
        onSignal: () => {},
        serviceContext: () => service.ctx,
      });
      return { code, out: out.join("\n") };
    };
    const from = fakeBinary("0.6.0");
    const refused = await run(["update", "--from", from, "--config", config]);
    expect(refused.code).toBe(1);
    const done = await run(["update", "--from", from, "--allow-downgrade", "--config", config]);
    expect(done.code).toBe(0);
    expect(existsSync(stableBinPath(service.ctx.home, "win32"))).toBe(true);
    const missing = await run(["update", "--config", config]);
    expect(missing.code).toBe(1);
    expect(missing.out).toContain("update needs --from");
  });

  test("CLI: com serviço, confere GET /health no endereço da config", async () => {
    const hits: string[] = [];
    const daemon = Bun.serve({
      port: 0,
      fetch: (req) => {
        hits.push(new URL(req.url).pathname);
        return Response.json({ ok: true });
      },
    });
    cleanups.push(() => daemon.stop(true));
    const service = fakeService("win32", DIST_WIN);
    const config = join(tempDir(), "config.json");
    writeFileSync(
      config,
      JSON.stringify({
        token: "t".repeat(32),
        dataDir: tempDir(),
        bind: "127.0.0.1",
        port: daemon.port,
      }),
    );
    let code = null as number | null;
    await runCli(["update", "--from", fakeBinary(NEWER), "--config", config], {
      env: {},
      log: { log: () => {}, error: () => {} },
      exit: (c) => {
        code = c;
      },
      onSignal: () => {},
      serviceContext: () => service.ctx,
    });
    expect(code).toBe(0);
    expect(service.calls.map((c) => c[1])).toEqual(["/Query", "/End", "/Create", "/Run"]);
    expect(hits).toEqual(["/v1/ws", "/health"]);
  });

  test("trava do binário: o preload reprova se o flightdeckd estável do home real mudar", () => {
    const home = tempDir();
    const guard = installBinaryGuard(home);
    expect(() => assertBinaryUntouched(guard)).not.toThrow();
    const stable = stableBinPath(home, process.platform);
    previous(stable);
    expect(() => assertBinaryUntouched(guard)).toThrow("binário real do flightdeckd mexido");
  });
});
