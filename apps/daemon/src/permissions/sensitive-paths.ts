/**
 * The paths a session must not read or write without a person saying so, in one place (issue #449):
 * the secrets (what `credential()` answers for, what OpenCode's read rules ask about, what a
 * worktree's ignored files never shrug at) and the control files (what a standing write
 * permission must never cover). Every other check derives from these lists.
 */

/** A file whose name starts with one of these holds a secret: `.env`, `.env.local`, `id_rsa`. */
export const SECRET_PREFIXES: readonly string[] = [".env", "id_"];
/** Files that hold a token, a password or a history of commands (issue #439). */
export const SECRET_NAMES: ReadonlySet<string> = new Set([
  ".claude.json",
  // A project's MCP servers carry their tokens in `env` and `headers` (#806).
  ".mcp.json",
  ".npmrc",
  ".netrc",
  "_netrc",
  ".pypirc",
  ".git-credentials",
  ".pgpass",
  ".vault-token",
  ".boto",
  ".s3cfg",
  ".my.cnf",
  ".mylogin.cnf",
  ".htpasswd",
  ".terraformrc",
  "credentials.tfrc.json",
  ".dockercfg",
  "auth.json",
  "wallet.dat",
  "authorized_keys",
  ".bash_history",
  ".zsh_history",
  ".psql_history",
  ".mysql_history",
  ".python_history",
  ".node_repl_history",
  ".rediscli_history",
  ".sqlite_history",
  "fish_history",
  "consolehost_history.txt",
]);
/** Key and certificate stores, and state that holds secrets. */
export const SECRET_EXTENSIONS: readonly string[] = [
  ".pem",
  ".key",
  ".env",
  ".pfx",
  ".p12",
  ".ppk",
  ".ovpn",
  ".keystore",
  ".jks",
  ".kdbx",
  ".keytab",
  ".tfstate",
  ".tfstate.backup",
];
/** Folders whose files are all secrets. */
export const SECRET_DIRS: readonly string[] = [".ssh", ".aws", ".gnupg", ".kube", ".azure", ".oci"];
/** A folder and a name in it (or a folder inside it) that hold secrets. */
export const SECRET_PAIRS: ReadonlyArray<readonly [string, string]> = [
  [".config", "gh"],
  [".claude", ".credentials.json"],
  // The person's own permissions and environment for the project (#806).
  [".claude", "settings.local.json"],
  [".flightdeck", "config.json"],
  [".docker", "config.json"],
  [".config", "gcloud"],
  [".config", "rclone"],
  [".config", "helm"],
  [".config", "doctl"],
  [".config", "glab-cli"],
  [".config", "containers"],
  [".cargo", "credentials"],
  [".cargo", "credentials.toml"],
  [".m2", "settings.xml"],
  [".m2", "settings-security.xml"],
  [".gradle", "gradle.properties"],
  [".terraform.d", "credentials.tfrc.json"],
  [".gem", "credentials"],
  ["github cli", "hosts.yml"],
];

/** Compares a path as the classifier does: without case, with either slash, with no empty step. */
export const pathParts = (text: string): string[] =>
  text
    .toLowerCase()
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".");

const follows = (parts: readonly string[], dir: string, next: string) =>
  parts.some((part, i) => part === dir && parts[i + 1] === next);

/**
 * Whether a path (or a glob, or a word of a command) names a credential: any of the lists above,
 * compared without case, with either slash, and with no regard to an empty or `.` step.
 */
export function credential(text: string): boolean {
  const parts = pathParts(text);
  const name = parts.at(-1) ?? "";
  return (
    SECRET_PREFIXES.some((prefix) => name.startsWith(prefix)) ||
    SECRET_NAMES.has(name) ||
    SECRET_EXTENSIONS.some((extension) => name.endsWith(extension)) ||
    SECRET_DIRS.some((dir) => parts.includes(dir)) ||
    SECRET_PAIRS.some(([dir, next]) => follows(parts, dir, next))
  );
}

/** The read globs OpenCode asks about: one family of paths for each entry of the lists. */
export function credentialReadGlobs(): string[] {
  return [
    ...new Set([
      ...SECRET_PREFIXES.map((prefix) => `*/${prefix}*`),
      ...[...SECRET_NAMES].map((name) => `*/${name}`),
      ...SECRET_EXTENSIONS.map((extension) => `*${extension}`),
      ...SECRET_DIRS.map((dir) => `*/${dir}/*`),
      ...SECRET_PAIRS.flatMap(([dir, next]) => [`*/${dir}/${next}`, `*/${dir}/${next}/*`]),
    ]),
  ];
}

/** Control directories: a path with one of these steps decides what the session may run. */
export const CONTROL_DIRS: readonly string[] = [".claude", ".git", ".husky"];
/** Control files, by name. */
export const CONTROL_NAMES: readonly string[] = [".mcp.json", "package.json"];
/** A control folder and a name in it. */
export const CONTROL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  [".github", "workflows"],
  [".vscode", "tasks.json"],
];

/**
 * The files that decide what the session may do or run: its own rules, the repository's hooks and
 * config, the scripts a test run starts, the CI. A standing permission to write one lets the
 * session end every hold, so no rule may cover them.
 */
export function isControl(path: string): boolean {
  const parts = pathParts(path);
  return (
    CONTROL_DIRS.some((dir) => parts.includes(dir)) ||
    CONTROL_NAMES.includes(parts.at(-1) ?? "") ||
    CONTROL_PAIRS.some(([dir, next]) => follows(parts, dir, next))
  );
}
