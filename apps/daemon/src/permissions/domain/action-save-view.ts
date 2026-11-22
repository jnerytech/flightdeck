/**
 * Issue #3752: what a person is shown when a session asks to run `flightdeckd action save`: the definition file's
 * `run`, `cwd`, `env` names and secret ids, not only its path. The functions here are pure; the adapter that reads
 * the file is `../action-save-note.ts`.
 */
import { parseJsonText } from "../../kernel/index.ts";
import { invocations, runsFlightdeckWords, shellWords, splitOutsideQuotes } from "./shell-call.ts";

const FLAG = "--definition-file";

/** A path the shell builds (`$DIR/d.json`, `*.json`, `~/d.json`): its text is not the file the CLI will open. */
const BUILT_BY_THE_SHELL = /[$`*?[{~]/;

/**
 * The value of `--definition-file` among a command's own arguments; null when there is none, when it is given twice
 * (the CLI keeps the last, so the first is not the file saved) or when the shell builds it.
 */
function fileOf(own: string[]): string | null {
  const at = own.flatMap((arg, i) => (arg === FLAG || arg.startsWith(`${FLAG}=`) ? [i] : []));
  if (at.length !== 1) return null;
  const arg = own[at[0] as number] as string;
  const value = arg === FLAG ? own[(at[0] as number) + 1] : arg.slice(FLAG.length + 1);
  if (value === undefined || value === "" || value.includes("\0") || BUILT_BY_THE_SHELL.test(value))
    return null;
  return value;
}

/** A change of folder anywhere in the text, quoted or not: `cd`, `pushd`, `popd`, `--chdir`, `-C`, `-D`. */
const CHANGES_FOLDER = /(^|[\s;&|("'`])(cd|pushd|popd|chdir)(\s|$|;|&|\|)|--chdir|\s-[CD](\s|=|$)/;

/** A path the shell reads from where it stands, not from the session's folder, once the command moved. */
const ABSOLUTE = /^([\\/]|[A-Za-z]:[\\/])/;

/** The files named by each `action save` that one program runs, directly or under a runner or a shell. */
function savesOf(prog: string, args: string[]): Array<string | null> {
  const found: Array<string | null> = [];
  runsFlightdeckWords(prog, args, ([command, verb], own) => {
    if (command === "action" && verb === "save") found.push(fileOf(own));
    // Always false: a line may hold several saves, and every reading of it has to be visited.
    return false;
  });
  return [...new Set(found)];
}

/** The `--definition-file` of each `action save` in a command line; null where a save names none. */
export function savedDefinitionFiles(command: string): Array<string | null> {
  const moves = CHANGES_FOLDER.test(command);
  const files: Array<string | null> = [];
  for (const statement of splitOutsideQuotes(command, ["&&", "||", ";", "&", "\n"])) {
    for (const part of splitOutsideQuotes(statement, ["|"])) {
      const words = shellWords(part);
      if (words.length === 0) continue;
      for (const call of invocations(words)) files.push(...savesOf(call.prog, call.args));
    }
  }
  // After a change of folder a relative file is read from a folder this view does not model.
  return moves ? files.map((file) => (file !== null && ABSOLUTE.test(file) ? file : null)) : files;
}

/**
 * A statement before the first `action save` that is not itself a save: it may write or replace the file the
 * save reads, after the note was made (`cp evil.json d.json && fd action save --definition-file d.json`).
 */
export function hasStepsBeforeSave(command: string): boolean {
  for (const statement of splitOutsideQuotes(command, ["&&", "||", ";", "&", "\n"])) {
    for (const part of splitOutsideQuotes(statement, ["|"])) {
      const words = shellWords(part);
      if (words.length === 0) continue;
      if (invocations(words).some((call) => savesOf(call.prog, call.args).length > 0)) return false;
      return true;
    }
  }
  return false;
}

const RUN_LIMIT = 300;
const SHORT_LIMIT = 120;
const MOST_NAMES = 20;
const DENY = "deny it unless you know what it holds";

/** Where a person who cannot read the file is told to stop. */
const NOT_SHOWN = (file: string) =>
  `${file}: its content could not be shown (unreadable, too large or not one JSON object): ${DENY}`;

/** Control characters, line separators, bidi overrides and zero-width marks: the text is read in a terminal or a dialog. */
const hidden = (code: number) =>
  code < 0x20 ||
  (code >= 0x7f && code <= 0x9f) ||
  (code >= 0x200b && code <= 0x200f) ||
  (code >= 0x2028 && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069) ||
  code === 0xfeff;

/** The rest of the format characters (soft hyphen, word joiner, tag characters): invisible, so they hide text. */
const FORMAT = /\p{Cf}/u;

/** Those characters become `?`; every other one (emoji included) stays. */
const printable = (text: string) =>
  Array.from(text, (char) =>
    hidden(char.codePointAt(0) ?? 0) || FORMAT.test(char) ? "?" : char,
  ).join("");

/** The start of `text` up to `limit` characters, and how many were left out (never a silent cut). */
function cut(text: string, limit: number): string {
  if (text.length <= limit) return text;
  // A cut between the two halves of an emoji would leave half of it.
  const end = /[\ud800-\udbff]/.test(text[limit - 1] ?? "") ? limit - 1 : limit;
  return `${text.slice(0, end)}… ${text.length - end} more characters not shown`;
}

const quoted = (value: string, limit = SHORT_LIMIT) => cut(printable(JSON.stringify(value)), limit);

const isText = (value: unknown): value is string => typeof value === "string";

/** `{{secret.x}}` and `{{secretFile.x}}` in the definition, as the ids of the secrets it will use. */
function secretIds(definition: Record<string, unknown>): string[] {
  const refs = JSON.stringify(definition).matchAll(
    /\{\{\s*secret(?:File)?\.([A-Za-z0-9._-]+)\s*\}\}/g,
  );
  return [...new Set([...refs].map((m) => m[1] as string))];
}

function runPart(run: unknown): string {
  if (!Array.isArray(run) || !run.every(isText)) return "run is not a list of text";
  return `run ${cut(printable(JSON.stringify(run)), RUN_LIMIT)}`;
}

function envPart(env: unknown): string {
  const names =
    typeof env === "object" && env !== null && !Array.isArray(env) ? Object.keys(env) : [];
  if (names.length === 0) return "env none";
  const shown = names.slice(0, MOST_NAMES).map((name) => cut(printable(name), SHORT_LIMIT));
  const more = names.length > MOST_NAMES ? `, … ${names.length - MOST_NAMES} more` : "";
  return `env ${shown.join(", ")}${more}`;
}

/** The definition in `text` as an object, or null when it is not one JSON object. */
function parseObject(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const value: unknown = parseJsonText(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** One sentence about the definition in `text` (the file's content, or null when it could not be read). */
export function describeDefinition(
  file: string | null,
  text: string | null,
  folder?: string,
): string {
  if (file === null)
    return `no definition file was found in the command: its content could not be shown, ${DENY}`;
  const definition = parseObject(text);
  if (definition === null) return NOT_SHOWN(printable(file));
  const parts = [
    ...(isText(definition.name) ? [`name ${quoted(definition.name)}`] : []),
    runPart(definition.run),
    ...(runPart(definition.run).includes("more characters not shown")
      ? [`the rest of run was not shown: ${DENY}`]
      : []),
    isText(definition.cwd) ? `cwd ${quoted(definition.cwd, RUN_LIMIT)}` : "cwd not set",
    ...(isText(definition.host) ? [`host ${quoted(definition.host)}`] : []),
    ...(isText(definition.ssh) ? [`ssh ${quoted(definition.ssh)}`] : []),
    ...(isText(definition.approval)
      ? [
          definition.approval === "never"
            ? "approval never (no approval is asked when it runs)"
            : `approval ${quoted(definition.approval).replaceAll('"', "")}`,
        ]
      : []),
    ...(Array.isArray(definition.tags) &&
    definition.tags.every(isText) &&
    definition.tags.length > 0
      ? [`tags ${cut(printable(definition.tags.join(", ")), SHORT_LIMIT)}`]
      : []),
    envPart(definition.env),
    `secrets ${secretIds(definition).join(", ") || "none"}`,
  ];
  const where = folder === undefined ? "" : ` (read in ${printable(folder)})`;
  return `saves ${printable(file)}${where}: ${parts.join("; ")}`;
}
