/**
 * What a host may offer the person to paste into a shell or open in a browser as the fix of a
 * dependency (HD-m1, HD-m2). The daemon's constants and the app both check against this list, so a
 * compromised host cannot choose the line a person runs.
 */

const COMMANDS: readonly RegExp[] = [
  /^sudo apt install [a-z0-9.+-]+$/,
  /^brew install [a-z0-9.@+-]+$/,
  /^winget install --id [A-Za-z0-9.]+$/,
  /^npm install -g @anthropic-ai\/claude-code$/,
  /^xcode-select --install$/,
  /^Add-WindowsCapability -Online -Name [A-Za-z0-9.~]+$/,
  /^flightdeckd (?:setup|service install|hooks install)$/,
  /^claude auth login$/,
  /^sudo loginctl enable-linger \$USER$/,
];

const PAGE_HOSTS: ReadonlySet<string> = new Set([
  "git-scm.com",
  "cli.github.com",
  "learn.microsoft.com",
  "tailscale.com",
  "docs.anthropic.com",
]);

/** True when `command` is one of the known fix commands, whole (no pipe, chain or substitution). */
export function safeFixCommand(command: string): boolean {
  return COMMANDS.some((pattern) => pattern.test(command));
}

/** True when `url` is an https address on one of the official install pages' hosts, with no credentials. */
export function safeFixUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      PAGE_HOSTS.has(parsed.hostname)
    );
  } catch {
    return false;
  }
}
