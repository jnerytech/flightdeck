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

/** Everything `service install|uninstall|status` touches, injected so tests never touch the OS. */
export interface ServiceContext {
  platform: string;
  home: string;
  user: string;
  /** The daemon command line, from `daemonCommand`. */
  command: string[];
  systemRoot: string;
  tempDir: string;
  /** Print what would be done; never write files nor run commands. */
  dryRun: boolean;
  exec: (cmd: string[]) => Promise<{ code: number; stdout: string }>;
  writeFile(path: string, content: string): void;
  removeFile(path: string): void;
  which(name: string): string | null;
}

export interface ServiceResult {
  output: string[];
  /** Steps the user must run themselves (anything needing sudo). */
  instructions: string[];
}

async function run(ctx: ServiceContext, cmd: string[]): Promise<string> {
  const { code, stdout } = await ctx.exec(cmd);
  if (code !== 0) throw new Error(`falhou (${code}): ${cmd.join(" ")}`);
  return stdout;
}

const SYSTEMD_INSTALL = [
  ["systemctl", "--user", "daemon-reload"],
  ["systemctl", "--user", "enable", "--now", "flightdeckd"],
];
const SYSTEMD_UNINSTALL = [
  ["systemctl", "--user", "disable", "--now", "flightdeckd"],
  ["systemctl", "--user", "daemon-reload"],
];

/** How a command line is shown in --dry-run output. */
const display = (cmd: string[]) =>
  cmd.map((arg) => (arg === TASK_NAME || /\s/.test(arg) ? `"${arg}"` : arg)).join(" ");

const unitPath = (ctx: ServiceContext) => posix.join(ctx.home, SYSTEMD_UNIT_PATH);
const taskXmlPath = (ctx: ServiceContext) => win32.join(ctx.tempDir, "flightdeckd-task.xml");

function requireSupported(ctx: ServiceContext): "linux" | "win32" {
  if (ctx.platform === "linux" || ctx.platform === "win32") return ctx.platform;
  throw new Error(`instalação como serviço não suportado em ${ctx.platform}`);
}

/** Installs the user unit; enabling linger needs sudo, so it is only printed. */
async function installSystemd(ctx: ServiceContext): Promise<ServiceResult> {
  const path = unitPath(ctx);
  const unit = systemdUnit(ctx.command);
  if (ctx.dryRun) {
    return {
      output: [`# ${path}`, unit, "# comandos:", ...SYSTEMD_INSTALL.map(display)],
      instructions: [],
    };
  }
  ctx.writeFile(path, unit);
  for (const cmd of SYSTEMD_INSTALL) await run(ctx, cmd);
  const linger = await ctx.exec(["loginctl", "show-user", ctx.user, "-p", "Linger"]);
  const instructions =
    linger.code === 0 && linger.stdout.trim() === "Linger=yes"
      ? []
      : [
          "O linger está desligado: o serviço só sobe depois do seu login. Para iniciar no boot, rode:",
          `  sudo loginctl enable-linger ${ctx.user}`,
        ];
  return {
    output: [`unit gravada em ${path}`, "serviço flightdeckd habilitado e iniciado"],
    instructions,
  };
}

async function installTask(ctx: ServiceContext): Promise<ServiceResult> {
  const xmlPath = taskXmlPath(ctx);
  const xml = windowsTaskXml(ctx.command, { user: ctx.user, systemRoot: ctx.systemRoot });
  const create = windowsTaskCreateArgs(xmlPath);
  if (ctx.dryRun) {
    return { output: [`# ${xmlPath}`, xml, "# comando:", display(create)], instructions: [] };
  }
  ctx.writeFile(xmlPath, xml);
  await run(ctx, create);
  return { output: [`tarefa ${TASK_NAME} criada para o logon de ${ctx.user}`], instructions: [] };
}

export async function installService(ctx: ServiceContext): Promise<ServiceResult> {
  return requireSupported(ctx) === "linux" ? installSystemd(ctx) : installTask(ctx);
}

export async function uninstallService(ctx: ServiceContext): Promise<ServiceResult> {
  const linux = requireSupported(ctx) === "linux";
  const commands = linux ? SYSTEMD_UNINSTALL : [windowsTaskDeleteArgs()];
  if (ctx.dryRun) {
    const remove = linux ? [`rm ${unitPath(ctx)}`] : [];
    return { output: ["# comandos:", ...commands.map(display), ...remove], instructions: [] };
  }
  await run(ctx, commands[0] as string[]);
  if (linux) {
    ctx.removeFile(unitPath(ctx));
    await run(ctx, commands[1] as string[]);
  }
  return { output: ["serviço removido"], instructions: [] };
}

/** Prints what the OS reports; a missing service is not an error here. */
export async function serviceStatus(ctx: ServiceContext): Promise<ServiceResult> {
  const cmd =
    requireSupported(ctx) === "linux"
      ? ["systemctl", "--user", "is-active", "flightdeckd"]
      : windowsTaskQueryArgs();
  const { stdout } = await ctx.exec(cmd);
  return { output: [stdout.trim() || "não instalado"], instructions: [] };
}

/**
 * The `claude` executable a service should use (services do not inherit the shell PATH).
 * On Windows a `.exe` is preferred: `.cmd` shims need a shell to run.
 */
export function resolveServiceClaude(ctx: ServiceContext): {
  path: string | null;
  warning?: string;
} {
  const path =
    ctx.platform === "win32"
      ? (ctx.which("claude.exe") ?? ctx.which("claude"))
      : ctx.which("claude");
  if (!path) {
    return {
      path: null,
      warning: "aviso: claude não encontrado no PATH; defina claude.executablePath na config",
    };
  }
  if (ctx.platform === "win32" && !path.toLowerCase().endsWith(".exe")) {
    return {
      path,
      warning: `aviso: ${path} não é um .exe; o serviço pode não conseguir executá-lo`,
    };
  }
  return { path };
}
