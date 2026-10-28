import { posix, win32 } from "node:path";

/** Unit file location, relative to the user's home. */
export const SYSTEMD_UNIT_PATH = ".config/systemd/user/flightdeckd.service";

const isCompiled = (main: string) => main.includes("$bunfs") || main.includes("~BUN");

/**
 * The command that starts this daemon: the binary itself when compiled, otherwise
 * `bun run <bin.ts>`. `start` is appended by each service format.
 */
export function daemonCommand(execPath: string, main: string): string[] {
  return isCompiled(main) ? [execPath] : [execPath, "run", main];
}

function requireAbsolute(command: string[]): void {
  const exe = command[0] ?? "";
  if (!posix.isAbsolute(exe) && !win32.isAbsolute(exe)) {
    throw new Error(`o serviço precisa de caminho absoluto, recebido: ${exe}`);
  }
}

/** systemd quoting: arguments with spaces or quotes go inside double quotes. */
const systemdQuote = (arg: string) =>
  /[\s"\\]/.test(arg) ? `"${arg.replace(/(["\\])/g, "\\$1")}"` : arg;

/** User unit for `systemctl --user`, restarting forever five seconds after any exit. */
export function systemdUnit(command: string[]): string {
  requireAbsolute(command);
  return [
    "[Unit]",
    "Description=Flightdeck daemon (flightdeckd)",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${[...command, "start"].map(systemdQuote).join(" ")}`,
    "Restart=always",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

/** Scheduled task path, inside its own `Flightdeck` folder. */
export const TASK_NAME = "Flightdeck\\flightdeckd";

const xmlEscape = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Windows command line: the executable always quoted, other arguments only with spaces. */
const windowsCommandLine = (command: string[]) =>
  command.map((arg, i) => (i === 0 || /\s/.test(arg) ? `"${arg}"` : arg)).join(" ");

/**
 * Task Scheduler XML: runs at the user's logon with the user's own token (no elevation),
 * restarts on failure and hides the console through `conhost.exe --headless`.
 */
export function windowsTaskXml(
  command: string[],
  options: { user: string; systemRoot: string },
): string {
  requireAbsolute(command);
  const user = xmlEscape(options.user);
  const conhost = xmlEscape(`${options.systemRoot}\\System32\\conhost.exe`);
  const args = xmlEscape(`--headless ${windowsCommandLine([...command, "start"])}`);
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Flightdeck daemon (flightdeckd)</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${user}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${user}</UserId>
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
      <Command>${conhost}</Command>
      <Arguments>${args}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

export function windowsTaskCreateArgs(xmlPath: string): string[] {
  return ["schtasks", "/Create", "/TN", TASK_NAME, "/XML", xmlPath, "/F"];
}

export function windowsTaskDeleteArgs(): string[] {
  return ["schtasks", "/Delete", "/TN", TASK_NAME, "/F"];
}

export function windowsTaskQueryArgs(): string[] {
  return ["schtasks", "/Query", "/TN", TASK_NAME];
}
