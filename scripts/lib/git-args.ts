import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** One `git(...)` call that gives a branch or revision to git with nothing between it and an option. */
export interface GitArgFinding {
  file: string;
  line: number;
  call: string;
}

/** The names a branch or a revision comes in from a project's settings or a protocol field. */
const REF_NAMES = "base|baseBranch|branch|source|rev|ref";
const CALL = /(?<![\w$])(?:this\.)?(?:git|gitLimited)\(/g;
/** An argument that begins with one of those names, bare or at the start of a template. */
const STARTS_WITH_REF = new RegExp(`^\`?(?:\\$\\{)?[\\w$.?]*\\b(?:${REF_NAMES})\\b`);
const REVIEWED = /\/\/ git-arg: \S/;

/** The source with comments and string contents blanked, same length, so offsets and lines hold. */
function blanked(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i] as string;
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") (out += " "), i++;
    } else if (c === "/" && next === "*") {
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i += 2;
    } else if (c === '"' || c === "'") {
      out += c;
      i++;
      while (i < source.length && source[i] !== c && source[i] !== "\n") {
        out += source[i] === "\\" ? "  " : "_";
        i += source[i] === "\\" ? 2 : 1;
      }
      out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** The text between the call's parentheses, with template strings read as one piece. */
function callBody(source: string, open: number): string | null {
  let depth = 0;
  let i = open;
  while (i < source.length) {
    const c = source[i] as string;
    if (c === "`") {
      i++;
      while (i < source.length && source[i] !== "`") {
        if (source[i] === "\\") i++;
        else if (source[i] === "$" && source[i + 1] === "{") {
          let braces = 0;
          do {
            if (source[i] === "{") braces++;
            if (source[i] === "}") braces--;
            i++;
          } while (i < source.length && braces > 0);
          continue;
        }
        i++;
      }
    } else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return source.slice(open + 1, i);
    i++;
  }
  return null;
}

/** The top-level arguments of a call body. */
function argsOf(body: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i] as string;
    if (c === "`") {
      i++;
      while (i < body.length && body[i] !== "`") i++;
    } else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      args.push(body.slice(start, i));
      start = i + 1;
    }
  }
  args.push(body.slice(start));
  return args.map((a) => a.trim());
}

/** Calls of `git(` and `gitLimited(` in `source` that pass a base or branch without a guard (issue #345). */
export function unguardedGitCalls(source: string, file = ""): GitArgFinding[] {
  const code = blanked(source);
  const lines = source.split("\n");
  const found: GitArgFinding[] = [];
  for (const match of code.matchAll(CALL)) {
    const open = (match.index as number) + match[0].length - 1;
    // The arguments are read from the real text (the blanked one has lost the strings).
    const body = callBody(source, open);
    if (body === null) continue;
    const args = argsOf(body);
    const ended = args.findIndex((a) => a === '"--end-of-options"' || a === '"--"');
    const exposed = (ended === -1 ? args : args.slice(0, ended)).some((a) =>
      STARTS_WITH_REF.test(a),
    );
    if (!exposed) continue;
    const line = source.slice(0, match.index).split("\n").length;
    const reviewed = REVIEWED.test(lines[line - 2] ?? "") || REVIEWED.test(lines[line - 1] ?? "");
    const lastLine = line + body.split("\n").length - 1;
    if (reviewed || REVIEWED.test(lines[lastLine - 1] ?? "")) continue;
    found.push({ file, line, call: body.replace(/\s+/g, " ").trim() });
  }
  return found;
}

/** The findings of every `.ts` file under `root`, files with none left out. */
export function unguardedInTree(root: string): GitArgFinding[] {
  const found: GitArgFinding[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".ts"))
        found.push(
          ...unguardedGitCalls(
            readFileSync(path, "utf8"),
            relative(root, path).replaceAll("\\", "/"),
          ),
        );
    }
  };
  walk(root);
  return found;
}
