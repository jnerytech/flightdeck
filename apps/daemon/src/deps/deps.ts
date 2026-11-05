import type { DepFeature, DepId, DepResult, DepsResult } from "@flightdeck/protocol";
import { compareVersions } from "../update.ts";

/** What the dependency probes need of the machine; tests give fakes, the daemon gives the real ones. */
export interface DepsEnv {
  platform: NodeJS.Platform;
  /** Where `name` is on the PATH (never `Bun.which` without options), or null. */
  which(name: string): string | null | Promise<string | null>;
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

type OsFix = { command?: string; url?: string; note?: "elevated" | "noSystemd" };

/** The fix per operating system: a package-manager command where one exists, and the install page. */
const fixes = (linux: OsFix, darwin: OsFix, win32: OsFix): Fix => [
  { os: "linux", ...linux },
  { os: "darwin", ...darwin },
  { os: "win32", ...win32 },
];

const CLAUDE_INSTALL = {
  command: "npm install -g @anthropic-ai/claude-code",
  url: "https://docs.anthropic.com/en/docs/claude-code/setup",
};

/** The least gh that has `gh project`, which board sync stands on (v2.31.0, "a new suite of project commands"). */
const GH_MIN = "2.31.0";

/** The least git that has `git worktree`: what every card, project and diff stands on. */
const GIT_MIN = "2.5.0";

const GIT_PAGE = "https://git-scm.com/downloads";
const GH_PAGE = "https://cli.github.com";
const AZ_PAGE = "https://learn.microsoft.com/cli/azure/install-azure-cli";
const SSH_PAGE =
  "https://learn.microsoft.com/windows-server/administration/openssh/openssh_install_firstuse";
const TAILSCALE_PAGE = "https://tailscale.com/download";

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
    fix: fixes(
      { command: "sudo apt install git", url: GIT_PAGE },
      { command: "brew install git", url: GIT_PAGE },
      { command: "winget install --id Git.Git", url: GIT_PAGE },
    ),
    min: GIT_MIN,
  },
  gh: {
    group: "optional",
    breaks: ["github", "pullRequests", "boardSync"],
    // The apt package of an LTS can be older than the gh that has `gh project`: Linux gets the page.
    fix: fixes(
      { url: GH_PAGE },
      { command: "brew install gh", url: GH_PAGE },
      { command: "winget install --id GitHub.cli", url: GH_PAGE },
    ),
    min: GH_MIN,
  },
  az: {
    group: "optional",
    breaks: ["azure"],
    // Linux has no one-line package install: the page lists the repository steps.
    fix: fixes(
      { url: "https://learn.microsoft.com/cli/azure/install-azure-cli-linux" },
      { command: "brew install azure-cli", url: AZ_PAGE },
      { command: "winget install --id Microsoft.AzureCLI", url: AZ_PAGE },
    ),
  },
  ssh: {
    group: "optional",
    breaks: ["remoteHosts", "teleport"],
    fix: fixes(
      { command: "sudo apt install openssh-client", url: SSH_PAGE },
      { command: "xcode-select --install", url: SSH_PAGE },
      {
        command: "Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0",
        url: SSH_PAGE,
        note: "elevated",
      },
    ),
  },
  tailscale: {
    group: "optional",
    breaks: ["pairing"],
    // Linux has no one-line package install either: the page picks the distribution.
    fix: fixes(
      { url: TAILSCALE_PAGE },
      { command: "brew install tailscale", url: TAILSCALE_PAGE },
      { command: "winget install --id Tailscale.Tailscale", url: TAILSCALE_PAGE },
    ),
  },
};

/** The first `1.2.3` (or `1.2`) in a program's `--version` line. */
const versionOf = (text: string | null) => /\d+(?:\.\d+)+/.exec(text ?? "")?.[0];

async function tool(env: DepsEnv, id: keyof typeof TOOLS): Promise<DepResult> {
  const spec = TOOLS[id];
  const base = { id, group: spec.group, breaks: spec.breaks, fix: spec.fix } as const;
  const path = await env.which(id);
  if (!path) return { ...base, state: "missing", ...(spec.min ? { minVersion: spec.min } : {}) };
  const version = versionOf(await env.version(path).catch(() => null));
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
  // Only Linux and Windows have a service manager to ask: on macOS the real command throws.
  if (env.platform !== "linux" && env.platform !== "win32")
    return { ...base, state: "na", fix: [] };
  const installed = await env.serviceInstalled();
  if (env.platform === "win32") {
    const path = await env.which("schtasks");
    const ok = path !== null && installed;
    return {
      ...base,
      state: ok ? "ok" : "missing",
      ...(path ? { path } : {}),
      fix: [{ os: "win32", command: "flightdeckd service install" }],
    };
  }
  const path = await env.which("systemctl");
  const linger = await env.linger();
  const ok = path !== null && installed && linger !== "off";
  // Without systemd there is no service to install: say so instead of offering a command that fails.
  if (path === null) {
    return { ...base, state: "missing", fix: [{ os: "linux", note: "noSystemd" }] };
  }
  return {
    ...base,
    state: ok ? "ok" : "missing",
    path,
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
    fix: fixes(
      { command: "claude auth login" },
      { command: "claude auth login" },
      { command: "claude auth login" },
    ),
  };
}

async function powershell(env: DepsEnv): Promise<DepResult> {
  const base = {
    id: "pwsh" as const,
    group: "optional" as const,
    breaks: ["windowsSetup"] as DepFeature[],
  };
  if (env.platform !== "win32") return { ...base, state: "na", fix: [] };
  const path = await env.which("pwsh");
  const fix: Fix = [{ os: "win32", command: "winget install --id Microsoft.PowerShell" }];
  if (!path) return { ...base, state: "missing", fix };
  const version = versionOf(await env.version(path).catch(() => null));
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
  // At the same time: one slow program (az takes seconds) costs its own time only.
  const ids = ["claude", "git", "gh", "az", "ssh", "tailscale"] as const;
  const tools = await Promise.all(ids.map((id) => tool(env, id)));
  for (const [i, id] of ids.entries()) found.set(id, tools[i] as DepResult);
  found.set("claudeAuth", await signedIn(env, found.get("claude")?.state === "missing"));
  found.set("service", await service(env));
  found.set("folders", folders);
  found.set("pwsh", await powershell(env));
  found.set("hooks", hooks);
  return { items: order.map((id) => found.get(id) as DepResult) };
}
