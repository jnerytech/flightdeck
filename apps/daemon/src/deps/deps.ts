import type { DepFeature, DepId, DepResult, DepsResult } from "@flightdeck/protocol";
import { compareVersions } from "../update.ts";

/** What the dependency probes need of the machine; tests give fakes, the daemon gives the real ones. */
export interface DepsEnv {
  platform: NodeJS.Platform;
  /** Where `name` is on the PATH (never `Bun.which` without options), or null. */
  which(name: string): string | null;
  /** What `<path> --version` says, or null when it does not answer. */
  version(path: string): Promise<string | null>;
  allowedRoots: readonly string[];
  /** Whether the daemon runs as a service of this machine. */
  serviceInstalled(): Promise<boolean>;
  /** Whether the user's systemd survives logout (Linux); null where it does not apply. */
  linger(): Promise<"on" | "off" | null>;
  hooks(): Promise<"installed" | "absent" | "outdated">;
  /** Who the host's own `claude` is signed in as, as the account card reads it (never a credential file); null when unknown. */
  account(): Promise<"signed_in" | "signed_out" | "api_key" | "third_party" | "unknown" | null>;
}

type Os = "linux" | "darwin" | "win32";
type Fix = DepResult["fix"];

const fixes = (linux: string, darwin: string, win32: string): Fix => [
  { os: "linux", command: linux },
  { os: "darwin", command: darwin },
  { os: "win32", command: win32 },
];

const CLAUDE_INSTALL = "npm install -g @anthropic-ai/claude-code";

/** The least git that has `git worktree`: what every card, project and diff stands on. */
const GIT_MIN = "2.5.0";

/** How each program is found and installed, and what stops working without it. */
const TOOLS: Record<
  "claude" | "git" | "gh" | "az" | "ssh" | "tailscale",
  { group: DepResult["group"]; breaks: DepFeature[]; fix: Fix; min?: string }
> = {
  claude: {
    group: "required",
    breaks: ["sessions"],
    fix: fixes(CLAUDE_INSTALL, CLAUDE_INSTALL, CLAUDE_INSTALL),
  },
  git: {
    group: "required",
    breaks: ["projects", "worktrees", "changes", "board"],
    fix: fixes("sudo apt install git", "brew install git", "winget install --id Git.Git"),
    min: GIT_MIN,
  },
  gh: {
    group: "optional",
    breaks: ["github", "pullRequests", "boardSync"],
    fix: fixes("sudo apt install gh", "brew install gh", "winget install --id GitHub.cli"),
  },
  az: {
    group: "optional",
    breaks: ["azure"],
    fix: fixes(
      "curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash",
      "brew install azure-cli",
      "winget install --id Microsoft.AzureCLI",
    ),
  },
  ssh: {
    group: "optional",
    breaks: ["remoteHosts", "teleport"],
    fix: fixes(
      "sudo apt install openssh-client",
      "xcode-select --install",
      "Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0",
    ),
  },
  tailscale: {
    group: "optional",
    breaks: ["pairing"],
    fix: fixes(
      "curl -fsSL https://tailscale.com/install.sh | sh",
      "brew install tailscale",
      "winget install --id Tailscale.Tailscale",
    ),
  },
};

/** The first `1.2.3` (or `1.2`) in a program's `--version` line. */
const versionOf = (text: string | null) => /\d+(?:\.\d+)+/.exec(text ?? "")?.[0];

async function tool(env: DepsEnv, id: keyof typeof TOOLS): Promise<DepResult> {
  const spec = TOOLS[id];
  const base = { id, group: spec.group, breaks: spec.breaks, fix: spec.fix } as const;
  const path = env.which(id);
  if (!path) return { ...base, state: "missing", ...(spec.min ? { minVersion: spec.min } : {}) };
  const version = versionOf(await env.version(path));
  const old = spec.min && version ? compareVersions(version, spec.min) < 0 : false;
  return {
    ...base,
    state: old ? "outdated" : "ok",
    path,
    ...(version ? { version } : {}),
    ...(spec.min ? { minVersion: spec.min } : {}),
  };
}

async function service(env: DepsEnv): Promise<DepResult> {
  const base = {
    id: "service" as const,
    group: "required" as const,
    breaks: ["autostart"] as DepFeature[],
  };
  const installed = await env.serviceInstalled();
  if (env.platform === "win32") {
    const path = env.which("schtasks");
    const ok = path !== null && installed;
    return {
      ...base,
      state: ok ? "ok" : "missing",
      ...(path ? { path } : {}),
      fix: [{ os: "win32", command: "flightdeckd service install" }],
    };
  }
  if (env.platform !== "linux") return { ...base, state: "na", fix: [] };
  const path = env.which("systemctl");
  const linger = await env.linger();
  const ok = path !== null && installed && linger !== "off";
  return {
    ...base,
    state: ok ? "ok" : "missing",
    ...(path ? { path } : {}),
    fix: [
      {
        os: "linux",
        command:
          linger === "off" ? "sudo loginctl enable-linger $USER" : "flightdeckd service install",
      },
    ],
  };
}

/** Claude Code signed in: what the account card reads, asked only when `claude` is there. */
async function signedIn(env: DepsEnv, noClaude: boolean): Promise<DepResult> {
  const base = {
    id: "claudeAuth" as const,
    group: "required" as const,
    breaks: ["sessions"] as DepFeature[],
  };
  const status = noClaude ? null : await env.account();
  if (status === null || status === "unknown") return { ...base, state: "na", fix: [] };
  if (status !== "signed_out") return { ...base, state: "ok", fix: [] };
  return {
    ...base,
    state: "missing",
    fix: fixes("claude auth login", "claude auth login", "claude auth login"),
  };
}

async function powershell(env: DepsEnv): Promise<DepResult> {
  const base = {
    id: "pwsh" as const,
    group: "optional" as const,
    breaks: ["windowsSetup"] as DepFeature[],
  };
  if (env.platform !== "win32") return { ...base, state: "na", fix: [] };
  const path = env.which("pwsh");
  const fix: Fix = [{ os: "win32", command: "winget install --id Microsoft.PowerShell" }];
  if (!path) return { ...base, state: "missing", fix };
  const version = versionOf(await env.version(path));
  return { ...base, state: "ok", path, ...(version ? { version } : {}), fix };
}

/** The host's dependencies, required and optional, each with what stops working without it. */
export async function checkDeps(env: DepsEnv): Promise<DepsResult> {
  const folders: DepResult = {
    id: "folders",
    group: "required",
    state: env.allowedRoots.length > 0 ? "ok" : "missing",
    breaks: ["sessions", "projects"],
    fix: [
      ...(["linux", "darwin", "win32"] as Os[]).map((os) => ({ os, command: "flightdeckd setup" })),
    ],
  };
  const hooksState = await env.hooks();
  const hooks: DepResult = {
    id: "hooks",
    group: "optional",
    state: hooksState === "installed" ? "ok" : hooksState === "outdated" ? "outdated" : "missing",
    breaks: ["liveStatus"],
    fix: (["linux", "darwin", "win32"] as Os[]).map((os) => ({
      os,
      command: "flightdeckd hooks install",
    })),
  };
  const order: DepId[] = [
    "claude",
    "claudeAuth",
    "git",
    "service",
    "folders",
    "gh",
    "az",
    "ssh",
    "tailscale",
    "pwsh",
    "hooks",
  ];
  const found = new Map<DepId, DepResult>();
  for (const id of ["claude", "git", "gh", "az", "ssh", "tailscale"] as const) {
    found.set(id, await tool(env, id));
  }
  found.set("claudeAuth", await signedIn(env, found.get("claude")?.state === "missing"));
  found.set("service", await service(env));
  found.set("folders", folders);
  found.set("pwsh", await powershell(env));
  found.set("hooks", hooks);
  return { items: order.map((id) => found.get(id) as DepResult) };
}
