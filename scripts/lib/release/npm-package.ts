/**
 * The npm package of the CLI (#3541): the launcher plus the daemons `build:daemon` made, packed on
 * Linux into `flightdeckd-<version>.tgz` and attached to the GitHub release. It is installed from that
 * file (`npm i -g <url>`), never from the registry, and runs no script at install time.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DAEMONS } from "./daemons.ts";

/** Where the launcher, its two entry files and the package manifest live; outside the workspaces. */
export const NPM_DIR = "release/npm";

const BINARY_NAMES = DAEMONS.map((path) => basename(path));
const SOURCES = ["fd.js", "flightdeckd.js", "launcher.js", "package.json"];
const MANIFEST = `${NPM_DIR}/package.json`;
const DEPENDENCY_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
  "devDependencies",
  "bundleDependencies",
  "bundledDependencies",
];

const sameList = (a: unknown, b: string[]) =>
  Array.isArray(a) && a.length === b.length && b.every((name) => a.includes(name));

/** What is wrong with the package manifest for a release at `version`; nothing when it is fine. */
export function npmManifestProblems(manifest: unknown, version: string): string[] {
  const m = (manifest ?? {}) as Record<string, unknown>;
  const bin = m.bin as Record<string, unknown> | undefined;
  const problems: string[] = [];
  if (m.version !== version)
    problems.push(`${MANIFEST} is at ${m.version}, the release is ${version}`);
  if (m.scripts !== undefined)
    problems.push(`${MANIFEST} declares scripts: an install must run nothing`);
  // npm installs a peer dependency by itself, so every kind counts, not only `dependencies`.
  if (DEPENDENCY_FIELDS.some((field) => m[field] !== undefined))
    problems.push(`${MANIFEST} declares dependencies: the tarball has none`);
  if (m.name !== "flightdeckd" || bin?.fd !== "fd.js" || bin?.flightdeckd !== "flightdeckd.js")
    problems.push(`${MANIFEST} bin must be fd and flightdeckd`);
  if (!sameList(m.files, [...SOURCES.filter((f) => f !== "package.json"), ...BINARY_NAMES]))
    problems.push(`${MANIFEST} files must be the launcher and the three binaries`);
  if (m.private !== true)
    problems.push(`${MANIFEST} must stay private: nothing goes to the registry`);
  return problems;
}

/**
 * Builds the folder `npm pack` runs in: the launcher files, the manifest and the three binaries of
 * `dist/`, all executable (an artifact download drops the bit, and a Windows checkout never had it).
 * Checks everything before writing anything. Returns the names it staged, sorted.
 */
export function stageNpmPackage(root: string, out: string, version: string): string[] {
  const missing = DAEMONS.filter((path) => !existsSync(join(root, path)));
  if (missing.length > 0) throw new Error(`faltam arquivos: ${missing.join(", ")}`);
  const manifest = JSON.parse(readFileSync(join(root, MANIFEST), "utf8"));
  const problems = npmManifestProblems(manifest, version);
  if (problems.length > 0) throw new Error(problems.join("\n"));
  mkdirSync(out, { recursive: true });
  const files = [
    ...SOURCES.map((name) => [join(root, NPM_DIR, name), name] as const),
    ...DAEMONS.map((path) => [join(root, path), basename(path)] as const),
  ];
  for (const [from, name] of files) {
    copyFileSync(from, join(out, name));
    chmodSync(join(out, name), name === "package.json" || name === "launcher.js" ? 0o644 : 0o755);
  }
  return files.map(([, name]) => name).sort((a, b) => (a < b ? -1 : 1));
}
