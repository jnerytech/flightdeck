/**
 * Issue #3704: what `flightdeckd session teleport` prints and the JSON a script reads. Pure: the runner moves
 * the session, this words what the person decides on and what came of it. A package's text (names, branch,
 * labels) comes from another host: the callers print it through `said`, `json` or `failure`, which strip the
 * marks that could drive the terminal.
 */
import type { TeleportManifest } from "@flightdeck/protocol";

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The secrets line: how many lines look like one and the kinds, never their text. */
function secretsLine(secrets: TeleportManifest["secrets"]): string {
  if (secrets.lines === 0) return "secrets: no line looks like one";
  const verb = secrets.lines === 1 ? "looks" : "look";
  const kinds = secrets.labels.length > 0 ? ` (${secrets.labels.join(", ")})` : "";
  return `secrets: ${count(secrets.lines, "line", "lines")} ${verb} like one${kinds}: they move with the session`;
}

/** What the person decides on: the app's dialog says the same, with the kinds of secrets and never their text. */
export function summaryLines(
  session: string,
  target: string,
  manifest: TeleportManifest,
): string[] {
  const { git, secrets } = manifest;
  const partList = manifest.parts.map((p) => `${p.name} ${size(p.size)}`).join(", ");
  return [
    `move ${session} to ${target}`,
    `model ${manifest.model ?? "default"}, permission mode ${manifest.permissionMode}, persona ${manifest.persona ?? "none"}`,
    `parts: ${partList}`,
    git
      ? `code: branch ${git.branch ?? "(detached)"}, ${count(git.ahead, "commit", "commits")} ahead of ${git.base}, ${count(git.changed, "file", "files")} changed`
      : "code: none",
    secretsLine(secrets),
  ];
}

/** The same, for `--json`: every field a count, a size or a kind. */
export function summaryJson(manifest: TeleportManifest) {
  return {
    model: manifest.model,
    permissionMode: manifest.permissionMode,
    persona: manifest.persona,
    parts: manifest.parts.map((p) => ({ name: p.name, size: p.size })),
    git: manifest.git
      ? { branch: manifest.git.branch, ahead: manifest.git.ahead, changed: manifest.git.changed }
      : null,
    secrets: { lines: manifest.secrets.lines, labels: manifest.secrets.labels },
  };
}

export const progressLine = (sent: number, total: number): string =>
  `sent ${sent} of ${total} bytes`;

export const movedLine = (
  session: string,
  target: string,
  landed: { sessionId: string; worktree: string; branch: string },
): string =>
  `moved ${session} to ${target} as session ${landed.sessionId} (branch ${landed.branch}, ${landed.worktree})`;

/** A refusal of the source's `teleport.prepare`, as a person acts on it; the daemon's own text when it has no word here. */
export function prepareRefusal(
  session: string,
  reason: string | undefined,
  detail: string,
): string {
  switch (reason) {
    case "teleport_busy":
      return `${session} is not idle: let it finish its turn, then move it`;
    case "teleport_team":
      return `${session} belongs to a team: a team's session does not move`;
    case "teleport_runtime":
      return `${session} does not run on Claude: only a Claude session moves`;
    case "teleport_no_transcript":
      return `${session} has no transcript to move yet`;
    case "teleport_too_many":
      return "the host is already holding as many moves as it allows: try again in a little while";
    case "teleport_stopped":
      return "the host is stopping: try again when it is back";
    default:
      return detail;
  }
}

/** Why the package of the source cannot be trusted, in the words of the runner's two refusals. */
export const packageRefusal = (reason: "teleport_corrupt" | "teleport_incomplete"): string =>
  reason === "teleport_corrupt"
    ? "the source sent a package that does not hold together: nothing was imported"
    : "the source stopped before the end of a part: nothing was imported";

/** What a person reads when the import did not answer: the session may be on the target already. */
export const importUnsure = (target: string): string =>
  `${target} did not answer the import: the session may or may not exist there. Look at its sessions before you move it again; the copy here was not archived`;
