import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Config } from "../../src/config.ts";
import { serviceCommand, systemdUnit } from "../../src/service/domain/install.ts";
import { compareVersions, stableBinPath } from "../../src/service/domain/version.ts";
import { tempDir } from "../support/helpers.ts";

import {
  DIST_LINUX,
  DIST_WIN,
  fakeBinary,
  fakeService,
  previous,
  setup,
  teardown,
  update,
} from "./update-setup.ts";

afterEach(teardown);

describe("update: service command, refusals and install flow", () => {
  test("caminho estável: ~/.flightdeck/bin/flightdeckd, .exe no Windows; versões comparadas por número", () => {
    expect(stableBinPath("C:\\Users\\dev", "win32")).toBe(
      join("C:\\Users\\dev", ".flightdeck", "bin", "flightdeckd.exe"),
    );
    expect(stableBinPath("/home/dev", "linux")).toBe(
      join("/home/dev", ".flightdeck", "bin", "flightdeckd"),
    );
    expect(compareVersions("0.8.0", "0.7.0")).toBeGreaterThan(0);
    expect(compareVersions("0.7.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  test("o comando e a config do serviço instalado saem da tarefa ou da unit", async () => {
    const spaced = "C:\\Program Files\\flightdeck\\flightdeckd.exe";
    expect(await serviceCommand(fakeService("win32", spaced).ctx)).toEqual({
      command: [spaced],
      config: null,
    });
    expect(
      await serviceCommand(
        fakeService("win32", DIST_WIN, "C:\\Users\\dev\\meu fd\\config.json").ctx,
      ),
    ).toEqual({ command: [DIST_WIN], config: "C:\\Users\\dev\\meu fd\\config.json" });
    expect(await serviceCommand(fakeService("linux", DIST_LINUX, "/etc/fd.json").ctx)).toEqual({
      command: [DIST_LINUX],
      config: "/etc/fd.json",
    });
    const quoted = "/home/dev/meu flightdeck/flightdeckd";
    expect(await serviceCommand(fakeService("linux", quoted, "/home/dev/a b/c.json").ctx)).toEqual({
      command: [quoted],
      config: "/home/dev/a b/c.json",
    });
    // From the source tree, the service runs bun with the entry point.
    const dev = ["C:\\bun\\bun.exe", "run", "D:\\repos\\flightdeck\\apps\\daemon\\src\\bin.ts"];
    expect(await serviceCommand(fakeService("win32", dev).ctx)).toEqual({
      command: dev,
      config: null,
    });
    expect(await serviceCommand(fakeService("linux", null).ctx)).toBeNull();
    expect(await serviceCommand(fakeService("win32", null).ctx)).toBeNull();
  });

  test("a drop-in that resets ExecStart and sets a new one is the command read back (#2895)", async () => {
    const { ctx } = fakeService("linux", null);
    const unit = systemdUnit(["/a/flightdeckd"], "/a/config.json");
    const dropIn =
      "# /home/dev/.config/systemd/user/flightdeckd.service.d/override.conf\n[Service]\nExecStart=\nExecStart=/b/flightdeckd start --config /b/config.json\n";
    ctx.exec = async () => ({ code: 0, stdout: `${unit}\n${dropIn}` });
    expect(await serviceCommand(ctx)).toEqual({
      command: ["/b/flightdeckd"],
      config: "/b/config.json",
    });
    ctx.exec = async () => ({ code: 0, stdout: `${unit}\n[Service]\nExecStart=\n` });
    expect(await serviceCommand(ctx)).toBeNull();
  });

  test("recusa binário sem --version válido e downgrade sem a flag", async () => {
    const { deps, out, calls, stable } = setup("win32", DIST_WIN);
    expect(await update(deps, fakeBinary(null))).toBe(1);
    expect(out.join("\n")).toContain("não respondeu a --version");
    expect(await update(deps, join(tempDir(), "nao-existe"))).toBe(1);
    expect(await update({ ...deps, versionTimeoutMs: 100 }, fakeBinary("hang"))).toBe(1);
    expect(await update(deps, fakeBinary("0.6.0"))).toBe(1);
    expect(out.join("\n")).toContain("--allow-downgrade");
    expect(calls).toEqual([]);
    expect(existsSync(stable)).toBe(false);
    expect(await update(deps, fakeBinary("0.6.0"), true)).toBe(0);
  });

  test("recusa com um daemon rodando sem serviço", async () => {
    const { deps, out, stable } = setup("win32", null, { running: true });
    expect(await update(deps, fakeBinary("0.8.0"))).toBe(1);
    expect(out.join("\n")).toContain("pare o daemon e rode de novo");
    expect(existsSync(stable)).toBe(false);
  });

  test("serviço parado que não solta o daemon: nada é trocado", async () => {
    const { deps, out, calls, stable } = setup("win32", DIST_WIN, { running: true });
    previous(stable);
    expect(await update(deps, fakeBinary("0.8.0"))).toBe(1);
    expect(out.join("\n")).toContain("o daemon não parou");
    expect(readFileSync(stable, "utf8")).toBe("versão antiga");
    expect(calls.map((c) => c[1])).toEqual(["/Query", "/End"]);
  });

  test("Windows: para a tarefa, troca o binário guardando o .old, reinstala no caminho estável, sobe e confere /health", async () => {
    const { deps, out, calls, written, stable, healthChecks } = setup("win32", DIST_WIN);
    previous(stable);
    const from = fakeBinary("0.8.0");
    expect(await update(deps, from)).toBe(0);
    expect(calls.map((c) => c[1])).toEqual(["/Query", "/End", "/Create", "/Run"]);
    expect(readFileSync(stable, "utf8")).toBe(readFileSync(from, "utf8"));
    expect(readFileSync(`${stable}.old`, "utf8")).toBe("versão antiga");
    expect(Object.values(written).join("\n")).toContain(stable);
    expect(healthChecks).toEqual([7420]);
    const text = out.join("\n");
    expect(text).toContain(`serviço reinstalado apontando para ${stable}`);
    expect(text).toContain("0.7.0 → 0.8.0");
    // The next update replaces the .old left by the previous success.
    expect(await update(deps, fakeBinary("0.9.0"))).toBe(0);
    expect(readFileSync(`${stable}.old`, "utf8")).toBe(readFileSync(from, "utf8"));
  });

  test("Linux: unit reescrita no caminho estável; serviço já no caminho estável não é reinstalado", async () => {
    const first = setup("linux", DIST_LINUX);
    expect(await update(first.deps, fakeBinary("0.8.0"))).toBe(0);
    expect(Object.values(first.written)).toEqual([systemdUnit([first.stable])]);
    expect(first.calls.map((c) => c.join(" "))).toEqual([
      "systemctl --user cat flightdeckd",
      "systemctl --user stop flightdeckd",
      "systemctl --user daemon-reload",
      "systemctl --user enable --now flightdeckd",
      "loginctl show-user dev -p Linger",
      "systemctl --user start flightdeckd",
    ]);
    const kept = setup("linux", null);
    const installed = setup("linux", kept.stable);
    installed.deps.stableBin = kept.stable;
    expect(await update(installed.deps, fakeBinary("0.8.0"))).toBe(0);
    expect(installed.calls.map((c) => c[2])).toEqual(["cat", "stop", "start"]);
    expect(installed.out.join("\n")).not.toContain("serviço reinstalado");
  });

  test("daemon novo que não responde: volta o .old e o serviço original, sobe de novo e sai com 1", async () => {
    const svcConfig = "C:\\fd\\config.json";
    const { deps, out, calls, written, stable } = setup("win32", DIST_WIN, {
      healthy: false,
      serviceConfig: svcConfig,
    });
    previous(stable);
    expect(await update(deps, fakeBinary("0.8.0"))).toBe(1);
    expect(readFileSync(stable, "utf8")).toBe("versão antiga");
    expect(existsSync(`${stable}.old`)).toBe(false);
    expect(calls.map((c) => c[1])).toEqual([
      "/Query",
      "/End",
      "/Create",
      "/Run",
      "/End",
      "/Create",
      "/Run",
    ]);
    // The task runs what it ran before, with the same config.
    expect(Object.values(written).join("\n")).toContain(
      `"${DIST_WIN}" start --config ${svcConfig}</Arguments>`,
    );
    expect(out.join("\n")).toContain("versão anterior foi restaurada");
    expect(out.join("\n")).toContain(`serviço reinstalado de volta em ${DIST_WIN}`);
  });

  test("primeiro update que falha: sem binário anterior, o serviço volta ao caminho original e sobe", async () => {
    const svcConfig = "/home/dev/fd/config.json";
    const fresh = setup("linux", DIST_LINUX, { healthy: false, serviceConfig: svcConfig });
    expect(await update(fresh.deps, fakeBinary("0.8.0"))).toBe(1);
    expect(existsSync(fresh.stable)).toBe(false);
    expect(Object.values(fresh.written)).toEqual([systemdUnit([DIST_LINUX], svcConfig)]);
    expect(fresh.calls.at(-1)?.join(" ")).toBe("systemctl --user start flightdeckd");
    expect(fresh.out.join("\n")).toContain(`serviço reinstalado de volta em ${DIST_LINUX}`);
  });

  test("reinstala no caminho estável mantendo o --config do serviço; sem --config no CLI, a porta do /health vem dele", async () => {
    const svcConfig = "C:\\fd\\config.json";
    const win = setup("win32", DIST_WIN, { serviceConfig: svcConfig });
    const loaded: string[] = [];
    win.deps.configFromService = (path) => {
      loaded.push(path);
      return Config.parse({ token: "s".repeat(32), port: 7555, dataDir: tempDir() });
    };
    expect(await update(win.deps, fakeBinary("0.8.0"))).toBe(0);
    expect(Object.values(win.written).join("\n")).toContain(
      `"${win.stable}" start --config ${svcConfig}</Arguments>`,
    );
    expect(loaded).toEqual([svcConfig]);
    expect(win.healthChecks).toEqual([7555]);
    // With --config on the CLI (no loader), that config decides the port.
    const explicit = setup("linux", DIST_LINUX, { serviceConfig: "/etc/fd.json" });
    expect(await update(explicit.deps, fakeBinary("0.8.0"))).toBe(0);
    expect(Object.values(explicit.written)).toEqual([
      systemdUnit([explicit.stable], "/etc/fd.json"),
    ]);
    expect(explicit.healthChecks).toEqual([7420]);
  });
});
