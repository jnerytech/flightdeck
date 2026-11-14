import { describe, expect, test } from "bun:test";
import {
  daemonCommand,
  type ServiceContext,
  SYSTEMD_UNIT_PATH,
  serviceCommand,
  systemdUnit,
} from "../../src/service/domain/install.ts";

/** What `serviceCommand` reads back from a unit whose `systemctl --user cat` answer is `text`. */
function readBack(text: string) {
  const ctx: ServiceContext = {
    platform: "linux",
    home: "/home/dev",
    user: "dev",
    command: [],
    systemRoot: "",
    tempDir: "/tmp",
    dryRun: false,
    exec: async () => ({ code: 0, stdout: text }),
    writeFile: () => {},
    removeFile: () => {},
    which: () => null,
  };
  return serviceCommand(ctx);
}

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
    expect(() => systemdUnit(["flightdeckd"])).toThrow("absolute path");
    expect(() => systemdUnit(["./bin/flightdeckd"])).toThrow("absolute path");
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

  test("a % or $ in a path is escaped in ExecStart and read back as the path (#2895)", async () => {
    const unit = systemdUnit(["/opt/$x/flightdeckd"], "/home/a%h/c.json");
    expect(unit).toContain("ExecStart=/opt/$$x/flightdeckd start --config /home/a%%h/c.json\n");
    expect(await readBack(unit)).toEqual({
      command: ["/opt/$x/flightdeckd"],
      config: "/home/a%h/c.json",
    });
    const spaced = systemdUnit(["/home/a b/$x%/flightdeckd"]);
    expect(spaced).toContain('ExecStart="/home/a b/$$x%%/flightdeckd" start\n');
    expect(await readBack(spaced)).toEqual({
      command: ["/home/a b/$x%/flightdeckd"],
      config: null,
    });
  });
});
