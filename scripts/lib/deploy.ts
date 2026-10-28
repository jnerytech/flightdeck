/** `bun run deploy <alias>`: build, copy over SSH, swap the binary and restart the user service. */

export interface DeployHost {
  /** `user@host` or an alias from ~/.ssh/config. */
  ssh: string;
  target: "linux-x64" | "linux-arm64";
  /** Remote binary path; `~` is expanded by the remote shell. */
  path: string;
}

const TARGETS = new Set(["linux-x64", "linux-arm64"]);
const SSH = /^[\w.-]+(@[\w.-]+)?$/;
// Goes unquoted into a remote shell command, so only plain path characters are allowed.
const PATH = /^[~\w./-]+$/;

export function parseDeployHosts(json: string): Record<string, DeployHost> {
  const raw = JSON.parse(json) as Record<string, Partial<DeployHost>>;
  const hosts: Record<string, DeployHost> = {};
  for (const [alias, host] of Object.entries(raw)) {
    const { ssh = "", target = "", path = "" } = host;
    if (!SSH.test(ssh) || !TARGETS.has(target) || !PATH.test(path)) {
      throw new Error(`deploy.hosts.json: entrada inválida em "${alias}"`);
    }
    hosts[alias] = { ssh, target: target as DeployHost["target"], path };
  }
  return hosts;
}

export function deployPlan(host: DeployHost, root: string): string[][] {
  const binary = `${root}/dist/flightdeckd-${host.target}`;
  const staged = `${host.path}.new`;
  return [
    [
      "bun",
      "build",
      `${root}/apps/daemon/src/bin.ts`,
      "--compile",
      `--target=bun-${host.target}`,
      "--outfile",
      binary,
    ],
    ["scp", binary, `${host.ssh}:${staged}`],
    [
      "ssh",
      host.ssh,
      `chmod +x ${staged} && mv ${staged} ${host.path} && systemctl --user restart flightdeckd`,
    ],
    ["ssh", host.ssh, "systemctl --user is-active flightdeckd"],
  ];
}

export interface DeployDeps {
  root: string;
  readHosts: () => string;
  exec: (cmd: string[]) => Promise<{ code: number; stdout: string }>;
  log: (message: string) => void;
}

/** Runs the plan step by step, stopping at the first failure. Returns the exit code. */
export async function runDeploy(alias: string, deps: DeployDeps): Promise<number> {
  let hosts: Record<string, DeployHost>;
  try {
    hosts = parseDeployHosts(deps.readHosts());
  } catch (error) {
    deps.log(`não foi possível ler deploy.hosts.json: ${(error as Error).message}`);
    return 1;
  }
  const host = hosts[alias];
  if (!host) {
    deps.log(`alias desconhecido: ${alias} (disponíveis: ${Object.keys(hosts).join(", ")})`);
    return 1;
  }
  let stdout = "";
  for (const cmd of deployPlan(host, deps.root)) {
    deps.log(`$ ${cmd.join(" ")}`);
    const result = await deps.exec(cmd);
    if (result.code !== 0) {
      deps.log(`falhou: ${cmd.join(" ")}`);
      return 1;
    }
    stdout = result.stdout.trim();
  }
  if (stdout !== "active") {
    deps.log(`flightdeckd não está ativo em ${alias}: ${stdout}`);
    return 1;
  }
  deps.log(`deploy de ${alias} concluído: flightdeckd ${stdout}`);
  return 0;
}
