import type { StreamParser } from "@codemirror/language";

/** The language of a file by its extension (lower case). */
const BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  py: "python",
  rs: "rust",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  toml: "toml",
  yml: "yaml",
  yaml: "yaml",
  css: "css",
  go: "go",
  html: "html",
  xml: "xml",
  diff: "diff",
  patch: "diff",
};

/** The language of a file by its whole name, for files with no extension. */
const BY_NAME: Readonly<Record<string, string>> = { dockerfile: "dockerfile" };

/**
 * Each language's parser, imported when first asked for: the viewer's chunk carries none of them
 * (CodeMirror's legacy modes, one module each).
 */
const LOADERS: Readonly<Record<string, () => Promise<StreamParser<unknown>>>> = {
  typescript: () => import("@codemirror/legacy-modes/mode/javascript").then((m) => m.typescript),
  javascript: () => import("@codemirror/legacy-modes/mode/javascript").then((m) => m.javascript),
  json: () => import("@codemirror/legacy-modes/mode/javascript").then((m) => m.json),
  python: () => import("@codemirror/legacy-modes/mode/python").then((m) => m.python),
  rust: () => import("@codemirror/legacy-modes/mode/rust").then((m) => m.rust),
  shell: () => import("@codemirror/legacy-modes/mode/shell").then((m) => m.shell),
  toml: () => import("@codemirror/legacy-modes/mode/toml").then((m) => m.toml),
  yaml: () => import("@codemirror/legacy-modes/mode/yaml").then((m) => m.yaml),
  css: () => import("@codemirror/legacy-modes/mode/css").then((m) => m.css),
  go: () => import("@codemirror/legacy-modes/mode/go").then((m) => m.go),
  html: () => import("@codemirror/legacy-modes/mode/xml").then((m) => m.html),
  xml: () => import("@codemirror/legacy-modes/mode/xml").then((m) => m.xml),
  diff: () => import("@codemirror/legacy-modes/mode/diff").then((m) => m.diff),
  dockerfile: () => import("@codemirror/legacy-modes/mode/dockerfile").then((m) => m.dockerFile),
};

/** The language that colors a file in the viewer, by its name; `null` for plain text. */
export function languageFor(path: string): string | null {
  const name = (path.split("/").at(-1) ?? "").toLowerCase();
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1) : "";
  return BY_EXTENSION[extension] ?? BY_NAME[name] ?? null;
}

/** The parser of a language, loaded when first asked for; `null` for one it does not know. */
export async function loadLanguage(key: string): Promise<StreamParser<unknown> | null> {
  const load = LOADERS[key];
  return load ? load() : null;
}
