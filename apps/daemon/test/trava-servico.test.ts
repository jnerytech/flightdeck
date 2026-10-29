import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isServiceController, osServiceContext } from "../src/service-os.ts";
import { tempDir } from "./helpers.ts";

describe("trava-servico", () => {
  test("systemctl, schtasks e loginctl (com caminho e .exe) são o controlador de serviço; o resto não", () => {
    for (const cmd of [
      ["systemctl", "--user", "stop", "flightdeckd"],
      ["schtasks", "/End", "/TN", "x"],
      ["C:\\Windows\\System32\\schtasks.exe", "/Run"],
      ["/usr/bin/loginctl", "show-user"],
      // Phase 9: the update runs outside the service through a transient user unit.
      ["systemd-run", "--user", "--collect", "--unit", "flightdeckd-update"],
    ]) {
      expect(isServiceController(cmd)).toBe(true);
    }
    expect(isServiceController([process.execPath, "-e", "0"])).toBe(false);
    expect(isServiceController([])).toBe(false);
  });

  test("com a trava ligada, o contexto real não executa o controlador e registra a tentativa", async () => {
    // First, so that without the guard nothing below ever reaches a real controller.
    expect(isServiceController(["schtasks"])).toBe(true);
    const log = join(tempDir(), "servico.log");
    const saved = process.env.FLIGHTDECK_SERVICE_GUARD;
    process.env.FLIGHTDECK_SERVICE_GUARD = log;
    try {
      const ctx = osServiceContext(false);
      expect(await ctx.exec(["systemctl", "--user", "stop", "flightdeckd"])).toEqual({
        code: 99,
        stdout: "",
      });
      expect(await ctx.exec(["schtasks", "/Run", "/TN", "Flightdeck\\flightdeckd"])).toEqual({
        code: 99,
        stdout: "",
      });
      expect(existsSync(log) ? readFileSync(log, "utf8").trim().split(/\r?\n/) : []).toEqual([
        "systemctl --user stop flightdeckd",
        "schtasks /Run /TN Flightdeck\\flightdeckd",
      ]);
      // Anything else still runs.
      expect((await ctx.exec([process.execPath, "-e", "process.exit(3)"])).code).toBe(3);
    } finally {
      process.env.FLIGHTDECK_SERVICE_GUARD = saved;
    }
  });

  test("o preload liga a trava para a suíte inteira", () => {
    expect(process.env.FLIGHTDECK_SERVICE_GUARD ?? "").not.toBe("");
  });
});
