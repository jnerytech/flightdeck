/**
 * The ssh command of a connection as rules (phase 15): the argv, the config and known_hosts text
 * and the askpass environment. Nothing here touches a file, a process or the clock.
 */
import type { SshTarget } from "@flightdeck/protocol";
import { knownHostsLines } from "./known-hosts.ts";

/** A terminal for the person, a reachability test, or an `ssh:` action (phase 17). */
export type Mode = "connect" | "test" | "exec";

/** What the daemon hands to the askpass helper of ssh (the `askpass` area fills it in). */
export interface AskpassHook {
  /** The program `SSH_ASKPASS` points to. */
  script: string;
  /** The daemon's config, so the helper finds the daemon. */
  configFile: string;
  /** A one-use ticket naming what ssh is going to ask for. Never the password itself. */
  ticket(target: SshTarget, kind: "password" | "passphrase"): string;
}

/** The part of a delivered key the argv needs: the file ssh reads it from, if any. */
type Delivered = { identityFile: string | null };

/** The value of a path in an ssh option or config: slashes on Windows, quotes around spaces. */
function sshValue(win: boolean, path: string): string {
  const text = win ? path.replaceAll("\\", "/") : path;
  return /\s/.test(text) ? `"${text}"` : text;
}

const nulDevice = (win: boolean): string => (win ? "NUL" : "/dev/null");

/** The known_hosts text: the pinned keys of every member of the chain. */
export function knownHostsText(
  members: SshTarget[],
  pinnedKeys: (id: string) => string[] | undefined,
): string {
  return `${members.flatMap((m) => knownHostsLines(m.host, m.port, pinnedKeys(m.id) ?? [])).join("\n")}\n`;
}

/** The ssh config text: strict host keys against our known_hosts, and the key file of each hop. */
export function sshConfigText(opts: {
  win: boolean;
  mode: Mode;
  knownHosts: string;
  hops: SshTarget[];
}): string {
  const { win, mode, knownHosts, hops } = opts;
  const lines = [
    "Host *",
    `  BatchMode ${mode === "connect" ? "no" : "yes"}`,
    "  StrictHostKeyChecking yes",
    `  UserKnownHostsFile ${sshValue(win, knownHosts)}`,
    `  GlobalKnownHostsFile ${nulDevice(win)}`,
    "  IdentitiesOnly no",
    "  ForwardAgent no",
  ];
  // ssh -J starts each jump with only -F: what a hop needs has to be in this file.
  for (const hop of hops) {
    if (hop.auth !== "key-file") continue;
    lines.push(
      `Host ${hop.host}`,
      `  IdentityFile ${sshValue(win, hop.secretRef as string)}`,
      "  IdentitiesOnly yes",
    );
  }
  return `${lines.join("\n")}\n`;
}

/** The `-o` and `-L` flags the target's own options ask for. */
function optionArgs(options: SshTarget["options"]): string[] {
  const argv: string[] = [];
  if (options.serverAliveInterval) {
    argv.push("-o", `ServerAliveInterval=${options.serverAliveInterval}`);
  }
  if (options.compression) argv.push("-o", "Compression=yes");
  for (const forward of options.localForward ?? []) argv.push("-L", forward);
  return argv;
}

/** The identity file flags and, for a password, the authentication methods. */
function identityArgs(win: boolean, target: SshTarget, delivered: Delivered | null): string[] {
  const argv: string[] = [];
  if (target.auth === "key-file") argv.push("-i", target.secretRef as string);
  if (delivered?.identityFile) {
    argv.push("-i", win ? delivered.identityFile.replaceAll("\\", "/") : delivered.identityFile);
  }
  if (target.auth === "password") {
    argv.push(
      "-o",
      "PreferredAuthentications=password,keyboard-interactive",
      "-o",
      "PubkeyAuthentication=no",
    );
  }
  return argv;
}

/** The ssh argv: a list that never goes through a shell. `remoteCommand` is the exec mode's command. */
export function sshArgv(opts: {
  sshPath: string;
  win: boolean;
  target: SshTarget;
  hops: SshTarget[];
  delivered: Delivered | null;
  files: { config: string; knownHosts: string };
  mode: Mode;
  remoteCommand: string;
}): string[] {
  const { sshPath, win, target, hops, delivered, files, mode } = opts;
  const usesFile = target.auth === "key-file" || delivered?.identityFile;
  const identitiesOnly = usesFile || target.auth === "password" ? "yes" : "no";
  const { options } = target;
  const argv = [
    sshPath,
    "-F",
    win ? files.config.replaceAll("\\", "/") : files.config,
    "-o",
    `BatchMode=${mode === "connect" ? "no" : "yes"}`,
    "-o",
    `IdentitiesOnly=${identitiesOnly}`,
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${sshValue(win, files.knownHosts)}`,
    "-o",
    `GlobalKnownHostsFile=${nulDevice(win)}`,
    "-o",
    `ForwardAgent=${options.forwardAgent ? "yes" : "no"}`,
  ];
  argv.push(...optionArgs(options), ...identityArgs(win, target, delivered));
  if (hops.length > 0) {
    const hop = (h: SshTarget) => {
      const host = h.host.includes(":") ? "[" + h.host + "]" : h.host;
      return `${h.user}@${host}:${h.port}`;
    };
    argv.push("-J", hops.map(hop).join(","));
  }
  if (mode !== "connect") argv.push("-o", "ConnectTimeout=10");
  // An action has no terminal: its output is read, and its stdin carries the environment.
  if (mode === "exec") argv.push("-T");
  argv.push("-p", String(target.port), "--", `${target.user}@${target.host}`);
  if (mode === "test") argv.push("exit", "0");
  if (mode === "exec") argv.push(opts.remoteCommand);
  return argv;
}

/** Passwords and key passphrases come from the vault through SSH_ASKPASS, with a ticket. */
export function askpassEnv(
  askpass: AskpassHook | undefined,
  target: SshTarget,
  mode: Mode,
): Record<string, string> {
  // BatchMode=yes never asks, so a test or an action has nothing to answer.
  if (!askpass || target.auth === "agent" || mode !== "connect") return {};
  const password = target.auth === "password";
  return {
    SSH_ASKPASS: askpass.script,
    SSH_ASKPASS_REQUIRE: password ? "force" : "prefer",
    FLIGHTDECK_ASKPASS_TICKET: askpass.ticket(target, password ? "password" : "passphrase"),
    FLIGHTDECK_CONFIG: askpass.configFile,
  };
}
