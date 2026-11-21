/**
 * Issue #3515: what `flightdeckd project trust-state|stack|trust-inspect|harness-preview` say, as pure rules
 * over the daemon's answers. The daemon calls and the exit codes stay in `projects/project-cli.ts`.
 */
import {
  HARNESS_DIGESTS_MAX,
  type HarnessApplied,
  HarnessApplied as HarnessAppliedAnswer,
  type HarnessCommitted,
  type HarnessDraft,
  type HarnessPreview,
  HarnessPreview as HarnessPreviewAnswer,
  type HarnessStack,
  type HarnessTemplateInfo,
  type Project,
  type ProjectDetectResult,
  type ProjectLoad,
  type ProjectsCloneResult,
  type ProjectsScanResult,
  type ProjectTrustStates,
} from "@flightdeck/protocol";
import { parseJsonText } from "../../kernel/index.ts";

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
  | (Printed & { action: "scan"; depth?: number })
  | (Printed & {
      action: "clone";
      url: string;
      root: string;
      name?: string;
      confirm: true;
    })
  | (Printed & { action: "stack"; path: string })
  | (Printed & { action: "trust-inspect"; path: string })
  | (Printed & {
      action: "harness-preview";
      path: string;
      parts: HarnessPart[];
      template?: string;
    });

/** How long the CLI waits for an answer: a clone runs `git` on the host, a preview reads files, the rest look up. */
export const callTimeoutMs = (args: ProjectCliArgs): number =>
  args.action === "clone" ? CLONE_WAIT_MS : LOOKUP_WAIT_MS;

/** The host stops a clone's `git` after five minutes: wait a little longer, so its own answer arrives. */
const CLONE_WAIT_MS = 6 * 60_000;
/** A preview reads the folder's files and a template's, which takes longer than a lookup. */
const LOOKUP_WAIT_MS = 30_000;

/** One line a repository found, and a line when the scan stopped at its cap. */
export const scanLines = (answer: ProjectsScanResult): string[] => [
  ...(answer.repos.length === 0
    ? ["no git repositories found in the allowed folders"]
    : answer.repos.map((repo) => `${repo.name}  ${repo.path}`)),
  ...(answer.truncated ? ["the scan stopped at its cap: more repositories may exist"] : []),
];

/** The folder the clone made. */
export const cloneLines = (answer: ProjectsCloneResult): string[] => [`cloned into ${answer.path}`];

/** One line a folder: whether it is trusted and through which record, and the live sessions that still run with the setup they loaded. */
export const trustLines = (answer: ProjectTrustStates): string[] =>
  answer.items.map((item) => {
    const via = item.via ? `  via ${item.via}` : "";
    const state = item.trusted ? `trusted${via}` : "not trusted";
    const sessions = item.staleSessions === 1 ? "session still runs" : "sessions still run";
    const stale = item.staleSessions
      ? `  ${item.staleSessions} ${sessions} with the setup they loaded`
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

/** The digests a request sends back, or what is wrong with the file they come from. */
export type SavedDigests = { digests: Record<string, string> } | { problem: string };

const parsedJson = (text: string): unknown => {
  try {
    return parseJsonText(text);
  } catch {
    return undefined;
  }
};

const tooMany = (file: string, count: number): SavedDigests | undefined =>
  count > HARNESS_DIGESTS_MAX
    ? { problem: `${file}: ${count} digests, and a request takes at most ${HARNESS_DIGESTS_MAX}` }
    : undefined;

/**
 * What `project harness-apply` sends back: each proposal's digest, by path, from a saved `harness-preview --json`
 * answer. The host makes the proposals again and refuses when one differs, so the file never carries content.
 */
export function previewDigests(file: string, text: string): SavedDigests {
  const json = parsedJson(text);
  if (json === undefined)
    return { problem: `${file}: not JSON; save the answer of fd project harness-preview --json` };
  const answer = HarnessPreviewAnswer.safeParse(json);
  if (!answer.success)
    return { problem: `${file}: not the answer of fd project harness-preview --json` };
  const { settings, files } = answer.data;
  const digests = {
    ...(settings ? { [settings.path]: settings.digest } : {}),
    ...Object.fromEntries(files.map((item) => [item.path, item.digest])),
  };
  const count = Object.keys(digests).length;
  if (count === 0) return { problem: `${file}: the preview has nothing to apply` };
  return tooMany(file, count) ?? { digests };
}

/** What `project harness-commit` sends back: the digests of the files a saved `harness-apply --json` answer says it wrote. */
export function appliedDigests(file: string, text: string): SavedDigests {
  const json = parsedJson(text);
  if (json === undefined)
    return { problem: `${file}: not JSON; save the answer of fd project harness-apply --json` };
  const answer = HarnessAppliedAnswer.safeParse(json);
  const digests = answer.success ? answer.data.digests : undefined;
  const count = Object.keys(digests ?? {}).length;
  if (digests === undefined || count === 0)
    return {
      problem: `${file}: no digests in it; save the answer of fd project harness-apply --json (a host from before the commit verb does not give them)`,
    };
  return tooMany(file, count) ?? { digests };
}

const filesLine = (count: number) => `${count} ${count === 1 ? "file" : "files"}`;

/** The files an apply wrote, in the order the host wrote them. */
export const appliedLines = (answer: HarnessApplied): string[] => [
  answer.written.length > 0 ? `wrote ${filesLine(answer.written.length)}` : "wrote nothing",
  ...answer.written.map((file) => `  ${file}`),
];

/** The branch a commit made, its short hash, and the files it holds. */
export const committedLines = (answer: HarnessCommitted): string[] => [
  `committed ${filesLine(answer.files.length)} on ${answer.branch}  ${answer.commit.slice(0, 12)}`,
  ...answer.files.map((file) => `  ${file}`),
];
