import { describe, expect, test } from "bun:test";
import {
  type ServiceContext,
  serviceCommand,
  TASK_NAME,
  windowsTaskCreateArgs,
  windowsTaskDeleteArgs,
  windowsTaskQueryArgs,
  windowsTaskXml,
} from "../../src/service/domain/install.ts";

/** What `serviceCommand` reads back from a task whose `schtasks /Query /XML` answer is `xml`. */
function readBack(xml: string) {
  const ctx: ServiceContext = {
    platform: "win32",
    home: "C:\\Users\\dev",
    user: "PC\\dev",
    command: [],
    systemRoot: "C:\\Windows",
    tempDir: "C:\\Temp",
    dryRun: false,
    exec: async () => ({ code: 0, stdout: xml }),
    writeFile: () => {},
    removeFile: () => {},
    which: () => null,
  };
  return serviceCommand(ctx);
}

const EXPECTED_XML = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Flightdeck daemon (flightdeckd)</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>PC\\dev</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>PC\\dev</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
    <Hidden>true</Hidden>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>C:\\Windows\\System32\\conhost.exe</Command>
      <Arguments>--headless "C:\\Users\\dev\\bin\\flightdeckd.exe" start</Arguments>
    </Exec>
  </Actions>
</Task>
`;

describe("tarefa-windows", () => {
  test("XML da tarefa bate com o texto esperado", () => {
    expect(
      windowsTaskXml(["C:\\Users\\dev\\bin\\flightdeckd.exe"], {
        user: "PC\\dev",
        systemRoot: "C:\\Windows",
      }),
    ).toBe(EXPECTED_XML);
  });

  test("argumentos do schtasks batem com o esperado e não pedem privilégio elevado", () => {
    expect(TASK_NAME).toBe("Flightdeck\\flightdeckd");
    const create = windowsTaskCreateArgs("C:\\Temp\\flightdeckd.xml");
    expect(create).toEqual([
      "schtasks",
      "/Create",
      "/TN",
      "Flightdeck\\flightdeckd",
      "/XML",
      "C:\\Temp\\flightdeckd.xml",
      "/F",
    ]);
    expect(windowsTaskDeleteArgs()).toEqual([
      "schtasks",
      "/Delete",
      "/TN",
      "Flightdeck\\flightdeckd",
      "/F",
    ]);
    expect(windowsTaskQueryArgs()).toEqual([
      "schtasks",
      "/Query",
      "/TN",
      "Flightdeck\\flightdeckd",
    ]);
    for (const args of [create, windowsTaskDeleteArgs(), windowsTaskQueryArgs()]) {
      expect(args).not.toContain("/RL");
      expect(args.join(" ")).not.toMatch(/HIGHEST|\/RU\b|SYSTEM/i);
    }
    const xml = windowsTaskXml(["C:\\x.exe"], { user: "u", systemRoot: "C:\\Windows" });
    expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(xml).not.toContain("HighestAvailable");
  });

  test("valores com caracteres especiais são escapados no XML e o caminho precisa ser absoluto", () => {
    const xml = windowsTaskXml(["C:\\R&D <x>\\bun.exe", "run", "C:\\repo\\bin.ts"], {
      user: "PC\\a&b",
      systemRoot: "D:\\Win",
    });
    expect(xml).toContain("<UserId>PC\\a&amp;b</UserId>");
    expect(xml).toContain("<Command>D:\\Win\\System32\\conhost.exe</Command>");
    expect(xml).toContain(
      '<Arguments>--headless "C:\\R&amp;D &lt;x&gt;\\bun.exe" run C:\\repo\\bin.ts start</Arguments>',
    );
    expect(() =>
      windowsTaskXml(["flightdeckd.exe"], { user: "u", systemRoot: "C:\\Windows" }),
    ).toThrow("absolute path");
  });

  test("an argument with a quote or a trailing backslash survives the task and its read back (#2895)", async () => {
    const exe = "C:\\Program Files\\fd\\flightdeckd.exe";
    const options = { user: "PC\\dev", systemRoot: "C:\\Windows" };
    const trailing = windowsTaskXml([exe], { ...options, config: "C:\\a b\\" });
    expect(trailing).toContain(
      '<Arguments>--headless "C:\\Program Files\\fd\\flightdeckd.exe" start --config "C:\\a b\\\\"</Arguments>',
    );
    expect(await readBack(trailing)).toEqual({ command: [exe], config: "C:\\a b\\" });
    const quoted = 'C:\\a "b" c\\d.json';
    expect(await readBack(windowsTaskXml([exe], { ...options, config: quoted }))).toEqual({
      command: [exe],
      config: quoted,
    });
    expect(await readBack(windowsTaskXml([exe, ""], options))).toEqual({
      command: [exe, ""],
      config: null,
    });
    const bare = 'C:\\x\\"y"';
    expect(await readBack(windowsTaskXml([exe, bare], options))).toEqual({
      command: [exe, bare],
      config: null,
    });
  });

  test("a run of backslashes before a quote or at the end survives the task and its read back (#2950)", async () => {
    const exe = "C:\\Program Files\\fd\\flightdeckd.exe";
    const options = { user: "PC\\dev", systemRoot: "C:\\Windows" };
    const runs = ['a\\\\"b c', 'a\\\\\\"b c', "a b\\\\\\", 'a\\\\"\\"b c\\\\'];
    for (const config of runs) {
      expect(await readBack(windowsTaskXml([exe], { ...options, config }))).toEqual({
        command: [exe],
        config,
      });
    }
    const two = windowsTaskXml([exe], { ...options, config: 'a\\\\"b c' });
    expect(two).toContain('start --config "a\\\\\\\\\\"b c"</Arguments>');
  });
});
