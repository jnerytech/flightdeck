import { describe, expect, test } from "bun:test";
import { daemonCommand, SYSTEMD_UNIT_PATH, systemdUnit } from "../src/service.ts";

describe("unit-systemd", () => {
  test("unit gerada bate com o texto esperado", () => {
    expect(systemdUnit(["/home/dev/.local/bin/flightdeckd"])).toBe(
      [
        "[Unit]",
        "Description=Flightdeck daemon (flightdeckd)",
        "After=network-online.target",
        "Wants=network-online.target",
        "",
        "[Service]",
        "Type=simple",
        "ExecStart=/home/dev/.local/bin/flightdeckd start",
        "Restart=always",
        "RestartSec=5",
        "",
        "[Install]",
        "WantedBy=default.target",
        "",
      ].join("\n"),
    );
  });

  test("contém caminho absoluto, Restart=always e RestartSec=5; caminhos com espaço vão entre aspas", () => {
    const unit = systemdUnit([
      "/opt/bun/bin/bun",
      "run",
      "/home/dev/my repo/apps/daemon/src/bin.ts",
    ]);
    expect(unit).toContain(
      'ExecStart=/opt/bun/bin/bun run "/home/dev/my repo/apps/daemon/src/bin.ts" start\n',
    );
    expect(unit).toContain("\nRestart=always\n");
    expect(unit).toContain("\nRestartSec=5\n");
  });

  test("caminho relativo é recusado", () => {
    expect(() => systemdUnit(["flightdeckd"])).toThrow("caminho absoluto");
    expect(() => systemdUnit(["./bin/flightdeckd"])).toThrow("caminho absoluto");
  });

  test("comando do daemon: binário compilado direto, código-fonte via bun run", () => {
    expect(daemonCommand("/home/dev/.local/bin/flightdeckd", "/$bunfs/root/flightdeckd")).toEqual([
      "/home/dev/.local/bin/flightdeckd",
    ]);
    expect(daemonCommand("/usr/bin/bun", "/repo/apps/daemon/src/bin.ts")).toEqual([
      "/usr/bin/bun",
      "run",
      "/repo/apps/daemon/src/bin.ts",
    ]);
    expect(daemonCommand("C:\\bin\\flightdeckd.exe", "B:\\~BUN\\root\\flightdeckd.exe")).toEqual([
      "C:\\bin\\flightdeckd.exe",
    ]);
  });

  test("a unit fica em ~/.config/systemd/user/flightdeckd.service", () => {
    expect(SYSTEMD_UNIT_PATH).toBe(".config/systemd/user/flightdeckd.service");
  });
});
