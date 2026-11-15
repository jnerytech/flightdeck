/**
 * How the guard reads a shell command (#759, #687): the text with heredoc bodies and quoted strings
 * masked, each git invocation with its folder, and a segment's env assignments and words. Every rule
 * reads the command through here, so a change here changes what each rule can see.
 */
import { resolve } from "node:path";

/** git options that take their value as the next word (`git -C <dir> add`). */
const GIT_OPTIONS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
]);

/** Where a heredoc starts on a line: `<<TAG`, `<<-TAG`, `<<'TAG'` or `<<"TAG"`. */
const HEREDOC_START = /<<-?[ \t]*(['"]?)(\w+)\1/;

/**
 * The command without heredoc bodies, which are data, not commands: from `<<TAG` to the line that
 * holds only TAG. A line scan, not one regex, so a long command cannot make it backtrack (S8786).
 */
function withoutHeredocs(command: string): string {
  const lines = command.split("\n");
  const kept: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    const start = HEREDOC_START.exec(line);
    const at = i;
    const end = start ? lines.findIndex((l, j) => j > at && l.trim() === start[2]) : -1;
    if (!start || end < 0) {
      kept.push(line);
      i += 1;
      continue;
    }
    kept.push(line.slice(0, start.index));
    // The body and its closing line are data: the scan goes on after them.
    i = end + 1;
  }
  return kept.join("\n");
}

export const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n\s*\2[ \t]*(?=\n|\)|$)/g; // NOSONAR: it reads one git commit command a session typed (a few KB), and the commit gate's tests pin its forms

/**
 * The command with heredoc bodies and the inside of quoted strings blanked to spaces, so every
 * offset still points at the same character of the original: words found here are commands, and
 * the values they take are read from the original at the same place.
 */
function maskCommand(command: string): string {
  const blank = (text: string) => " ".repeat(text.length);
  return command
    .replace(HEREDOC, (whole: string) => {
      const head = whole.indexOf("\n") + 1;
      return whole.slice(0, head) + blank(whole.slice(head));
    })
    .replace(
      /"(?:[^"\\]|\\.)*"|'[^']*'/g,
      // Not spaces (#759): a quoted value stays one word, so `-c x="a b"` cannot shift the subcommand.
      (quoted) => `${quoted[0]}${"_".repeat(quoted.length - 2)}${quoted[0]}`,
    );
}

/**
 * What a word means once its quotes are read: `$'...'` and backticks are not read (the word stays
 * as typed, which nothing matches, #759 review), quoted text loses its quotes, the rest is as is.
 */
function wordValue(typed: string, masked: string): string {
  if (/\$'|`/.test(typed)) return typed;
  return /["']/.test(masked) ? unquote(typed) : masked;
}

/** A shell word as the shell reads it, quotes taken out (a `\` escape inside double quotes too). */
function unquote(word: string): string {
  return word.replace(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g, (_, double?: string, single?: string) =>
    // In double quotes the shell drops a backslash only before $ ` " \ or a newline.
    double === undefined ? (single ?? "") : double.replace(/\\([$`"\\\n])/g, "$1"),
  );
}

/** The value of an option that starts at `at` in the original command. */
export function optionValue(command: string, at: number): string | null {
  if (command.startsWith('"$(', at)) {
    HEREDOC.lastIndex = 0;
    return HEREDOC.exec(command.slice(at))?.[3] ?? null;
  }
  const quoted = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/y;
  quoted.lastIndex = at;
  const m = quoted.exec(command);
  if (!m) return null;
  return m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : (m[2] ?? m[3] ?? null);
}

export interface GitCall {
  /** The subcommand (`commit`, `push`, ...). */
  sub: string;
  /** Where it runs; null when a directory is quoted (its words are hidden from the parse). */
  dir: string | null;
  /** The words after the subcommand, from the masked command, with their offsets and their text
   * unquoted from the original (`value`, #759: `"main"` is main). */
  args: { word: string; at: number; value: string }[];
  /** The masked segment's start and end in the command. */
  start: number;
  end: number;
}

/** The folder a `cd` or `git -C` goes to; null when it cannot be told (nowhere known, nothing or a quoted word). */
function enter(dir: string | null, target: string): string | null {
  // A folder the hook cannot read as the shell would (a quote left over, $'...', `...`) is unknown.
  const unread = /["'`]|\$'/.test(target);
  return dir === null || !target || unread ? null : resolve(dir, target);
}

/** Each git invocation in the command, with its directory (each `cd` before it, `git -C`). */
export function gitCalls(command: string, cwd: string): GitCall[] {
  const calls: GitCall[] = [];
  let dir: string | null = cwd;
  for (const segment of maskCommand(command).matchAll(/[^;&|\n]+/g)) {
    const tokens = [...segment[0].matchAll(/\S+/g)].map((t) => {
      const at = segment.index + t.index;
      // A word reads as its text with the quotes taken out (#759: `git "push"`, `ma"in"`): the mask
      // keeps every length, so the same span of the original command is the word as typed.
      // $'...' and `...` are not read: such a word stays as typed, which nothing matches (#759 review).
      const typed = command.slice(at, at + t[0].length);
      const value = wordValue(typed, t[0]);
      return { word: t[0], at, value };
    });
    const word = (i: number) => tokens[i]?.word ?? "";
    const value = (i: number) => tokens[i]?.value ?? "";
    if (word(0) === "cd") {
      dir = enter(dir, value(1));
      continue;
    }
    const found = tokens.findIndex((t) => t.word === "git");
    if (found < 0) continue;
    let at = dir;
    let i = found + 1;
    for (; word(i).startsWith("-"); i += GIT_OPTIONS_WITH_VALUE.has(word(i)) ? 2 : 1) {
      if (word(i) === "-C") at = enter(at, value(i + 1));
    }
    calls.push({
      sub: value(i),
      dir: at,
      args: tokens.slice(i + 1),
      start: segment.index,
      end: segment.index + segment[0].length,
    });
  }
  return calls;
}

/** The command's segments, split at ; & | and newlines outside quotes, without heredoc bodies. */
export function rawSegments(command: string): string[] {
  const text = withoutHeredocs(command);
  const segments: string[] = [];
  let current = "";
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    // A backslash escapes the next character, except inside single quotes.
    if (quote !== "'" && ch === "\\") {
      current += ch + (text[++i] ?? "");
    } else if (quote) {
      current += ch;
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (";&|\n".includes(ch)) {
      segments.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  return [...segments, current];
}

/** One `NAME=value` env assignment at the start of the text, with the value unquoted (#687). */
const ASSIGNMENT = /^([A-Za-z_]\w*)=(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S*))(?:\s+|$)/;

/** The value of the env assignment `name` in front of a segment's command, or undefined. */
export function prefixAssignment(segment: string, name: string): string | undefined {
  let rest = segment.trimStart().replace(/^env\s+/, "");
  for (let found = ASSIGNMENT.exec(rest); found; found = ASSIGNMENT.exec(rest)) {
    if (found[1] === name) return found[2] ?? found[3] ?? found[4] ?? "";
    rest = rest.slice(found[0].length);
  }
  return undefined;
}

/** A segment's words, with a quoted string (and what it touches) kept whole as one word. */
export function shellWords(segment: string): string[] {
  return segment.match(/(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s"'])+/g) ?? [];
}

/** The command without heredoc bodies and quoted text, which are data, not commands. */
export function commandWords(command: string): string {
  return withoutHeredocs(command).replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
}
