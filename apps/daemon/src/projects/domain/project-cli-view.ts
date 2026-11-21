/**
 * Issue #3515: what `flightdeckd project trust-state|stack|trust-inspect|harness-preview` say, as pure rules
 * over the daemon's answers. The daemon calls and the exit codes stay in `projects/project-cli.ts`.
 */
import type {
  HarnessDraft,
  HarnessPreview,
  HarnessStack,
  HarnessTemplateInfo,
  Project,
  ProjectDetectResult,
  ProjectLoad,
  ProjectTrustStates,
} from "@flightdeck/protocol";

/** The parts a harness preview may name: the protocol's own list. */
export type HarnessPart = "claudeMd" | "hooks" | "skills" | "agents" | "permissions";

/** The fields of a project that `project add` and `project update` set, as the protocol takes them (a field left out keeps its value). */
export interface ProjectFields {
  name?: string;
  baseBranch?: string;
  prProvider?: "github" | "azure-devops" | "none";
  /** `null` removes the script. */
  setupScript?: string | null;
  promptTemplate?: string;
  autoApprove?: { enabled: boolean };
  personaSubagents?: "all" | "project" | "none";
  /** `null` removes the default; `update` only. */
  defaultHours?: number | null;
}

/** What the person typed for `project <verb>`, as `runProjectCli` takes it. `--json` prints the daemon's own answer. */
interface Printed {
  json?: boolean;
}
export type ProjectCliArgs =
  | (Printed & { action: "detect-provider"; project: string })
  | (Printed & { action: "add"; path: string; fields: ProjectFields })
  | (Printed & { action: "update"; project: string; fields: ProjectFields })
  | (Printed & {
      action: "harness-apply";
      path: string;
      parts: HarnessPart[];
      /** The saved `harness-preview --json` answer whose digests the apply sends back. */
      digestsFile: string;
      template?: string;
      reformat?: true;
      confirm: true;
    })
  | (Printed & {
      action: "harness-commit";
      path: string;
      /** The saved `harness-apply --json` answer: the digests of the files it wrote. */
      digestsFile: string;
      confirm: true;
    })
  | (Printed & { action: "harness-draft"; path: string })
  | (Printed & { action: "harness-export"; path: string; id: string; title: string })
  | (Printed & { action: "trust-state"; paths: string[] })
  | (Printed & { action: "stack"; path: string })
  | (Printed & { action: "trust-inspect"; path: string })
  | (Printed & {
      action: "harness-preview";
      path: string;
      parts: HarnessPart[];
      template?: string;
    });

/** One line a folder: whether it is trusted and through which record, and the live sessions that still run with the setup they loaded. */
export const trustLines = (answer: ProjectTrustStates): string[] =>
  answer.items.map((item) => {
    const state = item.trusted ? `trusted${item.via ? `  via ${item.via}` : ""}` : "not trusted";
    const stale = item.staleSessions
      ? `  ${item.staleSessions} ${item.staleSessions === 1 ? "session still runs" : "sessions still run"} with the setup they loaded`
      : "";
    return `${item.path}  ${state}${stale}`;
  });

const COMMANDS = ["test", "lint", "format", "build"] as const;
/** The stacks the host found, then the four commands it would use, a dash for one it did not find. */
export const stackLines = (answer: HarnessStack): string[] => [
  `${"stacks".padEnd(6)}  ${answer.stacks.length > 0 ? answer.stacks.join(", ") : "none detected"}`,
  ...COMMANDS.map((name) => `${name.padEnd(6)}  ${answer.commands[name] ?? "-"}`),
];

/** A list with its entries under it, one per line; nothing when the list is empty. */
const entries = (label: string, rows: string[]): string[] =>
  rows.length > 0 ? [`${label}: ${rows.length}`, ...rows.map((row) => `  ${row}`)] : [];
/** A list of names on one line; nothing when the list is empty. */
const names = (label: string, rows: string[]): string[] =>
  rows.length > 0 ? [`${label}: ${rows.join(", ")}`] : [];

const OMITTED_LABELS: Array<[keyof ProjectLoad["omitted"], string]> = [
  ["hooks", "hooks"],
  ["mcpServers", "mcp servers"],
  ["allowRules", "allow rules"],
  ["denyRules", "deny rules"],
  ["envKeys", "env keys"],
];

/**
 * What the folder's own files would load into a session, the parts that decide what runs or what is allowed
 * named in full (hook commands, servers, programs, redirects, rules), the rest by name.
 */
export function inspectLines(answer: ProjectLoad): string[] {
  const left = OMITTED_LABELS.filter(([key]) => (answer.omitted[key] ?? 0) > 0).map(
    ([key, label]) => `${label} ${answer.omitted[key]}`,
  );
  const lines = [
    ...entries(
      "hooks",
      answer.hooks.flatMap((hook) =>
        hook.commands.map((command) => `${hook.event}  ${hook.file}  ${command}`),
      ),
    ),
    ...entries(
      "mcp servers",
      answer.mcpServers.map((server) => `${server.name}  ${server.file}  ${server.command}`),
    ),
    ...entries(
      "executables",
      answer.executables.map((item) => `${item.key}  ${item.file}  ${item.command}`),
    ),
    ...entries(
      "redirects",
      answer.redirects.map((item) => `${item.key}  ${item.file}  ${item.value}`),
    ),
    ...entries("allow rules", answer.allowRules),
    ...entries("deny rules", answer.denyRules ?? []),
    ...(answer.defaultMode ? [`default mode: ${answer.defaultMode}`] : []),
    ...names("env keys", answer.envKeys),
    ...names("agents", answer.agents),
    ...names("skills", answer.skills),
    ...names("commands", answer.commands),
    ...(answer.claudeMd ? ["claude.md: yes"] : []),
    ...names("plugins", answer.plugins),
    ...names("other settings", answer.otherKeys),
    ...names(
      "extras",
      answer.extras.map((extra) => `${extra.file} (${extra.keys.join(", ")})`),
    ),
    ...names("unreadable", answer.unreadable),
    ...(left.length > 0 ? [`left out of the lists: ${left.join(", ")}`] : []),
  ];
  return [answer.path, ...(lines.length > 0 ? lines : ["loads nothing"])];
}

/**
 * What applying the chosen parts would add: the settings entries (never the file's text, which may hold
 * values), and each new file by its size and digest, not its content; `--json` has the whole answer.
 */
export function previewLines(answer: HarnessPreview): string[] {
  const settings = answer.settings;
  const lines = [
    ...(settings
      ? [
          `${settings.path}  hash ${settings.hash ?? "none"}  digest ${settings.digest}`,
          ...settings.hooks.map(
            (hook) => `  hook  ${hook.event}  ${hook.matcher}  ${hook.command}`,
          ),
          ...settings.denyRules.map((rule) => `  deny  ${rule}`),
          ...settings.conflicts.map((key) => `  conflict  ${key}`),
          ...(settings.reformats ? ["  the file would be rewritten with another layout"] : []),
        ]
      : []),
    ...answer.files.map(
      (file) =>
        `file  ${file.path}  ${Buffer.byteLength(file.content)} bytes  digest ${file.digest}`,
    ),
    ...answer.unreadable.map((path) => `unreadable  ${path}`),
    ...(answer.withheld ?? []).map((item) => `withheld  ${item.path}  ${item.reason}`),
  ];
  return lines.length > 0 ? lines : ["nothing to add"];
}

/** What `project add` and `project update` did: the project, and for an update the fields the person changed. */
export const projectLines = (
  verb: "added" | "updated",
  project: Project,
  fields: ProjectFields,
): string[] => [
  verb === "added"
    ? `added ${project.name} (${project.id})  ${project.path}`
    : `updated ${project.name} (${project.id})  changed ${Object.keys(fields).join(", ")}`,
];

/** What looking at the project's remote did, in words. */
export const detectLines = (name: string, answer: ProjectDetectResult): string[] => {
  const said: Record<ProjectDetectResult["outcome"], string> = {
    set: `the PR provider is now ${answer.project.prProvider}`,
    kept: `the PR provider stays ${answer.project.prProvider}`,
    no_remote: "the repository has no origin remote",
    unsupported: `the origin is on ${answer.host ?? "another service"}, which is not GitHub or Azure DevOps`,
    unreadable: "git could not read the repository",
  };
  return [`${name}: ${said[answer.outcome]}`];
};

/** The drafted CLAUDE.md: the digest an apply would repeat, then its text. */
export const draftLines = (draft: HarnessDraft): string[] => [
  `${draft.path}  digest ${draft.digest}`,
  "",
  ...draft.content.split("\n"),
];

/** The template an export made: its id, title and size, then its files. */
export const exportLines = (info: HarnessTemplateInfo): string[] => [
  `exported ${info.id}  ${info.title}  ${info.files.length} ${info.files.length === 1 ? "file" : "files"}, ${info.bytes} bytes`,
  ...info.files.map((file) => `  ${file}`),
];
