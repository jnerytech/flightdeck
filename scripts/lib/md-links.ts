/**
 * Links between the repository's Markdown files, checked: a relative link names a file that
 * exists and an anchor names a heading of it (as GitHub slugs it), and the code's `docs/...md`
 * paths exist. Splitting or moving docs breaks these silently otherwise.
 */

import { posix } from "node:path";

/**
 * `[text](target)` replaced by `text`, in one pass: each `indexOf` resumes where the last one
 * stopped, so an input of many brackets is not rescanned from every one of them.
 */
function unlink(text: string): string {
  let out = "";
  let from = 0;
  let open = text.indexOf("[");
  while (open !== -1) {
    const close = text.indexOf("]", open + 1);
    if (close === -1) break;
    if (text[close + 1] !== "(") {
      open = text.indexOf("[", close + 1);
      continue;
    }
    const end = text.indexOf(")", close + 2);
    if (end === -1) break;
    out += text.slice(from, open) + text.slice(open + 1, close);
    from = end + 1;
    open = text.indexOf("[", from);
  }
  return out + text.slice(from);
}

/** The anchor GitHub gives a heading. */
export function githubSlug(heading: string): string {
  return unlink(heading)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replaceAll(" ", "-");
}

/** The lines of a Markdown file outside fenced code blocks, with their 1-based numbers. */
function proseLines(markdown: string): { line: string; n: number }[] {
  const out: { line: string; n: number }[] = [];
  let fenced = false;
  markdown.split("\n").forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced) out.push({ line, n: i + 1 });
  });
  return out;
}

/**
 * The text of an ATX heading line (`## Text ##`), or undefined for any other line. The closing
 * hashes and the spaces around them go: whitespace, then the hashes, then whitespace again, each
 * stripped once from the end.
 */
function headingText(line: string): string | undefined {
  const opening = /^#{1,6}\s+/.exec(line);
  if (!opening) return undefined;
  const trimmed = line.slice(opening[0].length).trimEnd();
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1] === "#") end--;
  const text = trimmed.slice(0, end).trimEnd();
  return /[\n\r\u2028\u2029]/.test(text) ? undefined : text;
}

/** The anchors of a Markdown file: one per heading, duplicates numbered -1, -2... */
export function anchorsOf(markdown: string): Set<string> {
  const seen = new Map<string, number>();
  const anchors = new Set<string>();
  for (const { line } of proseLines(markdown)) {
    const heading = headingText(line);
    if (heading === undefined) continue;
    const slug = githubSlug(heading);
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    anchors.add(n === 0 ? slug : `${slug}-${n}`);
  }
  return anchors;
}

/** Every broken relative link of these files, as `file:line: target (reason)`. */
export function brokenLinks(
  files: Map<string, string>,
  exists: (path: string) => boolean,
): string[] {
  const anchors = new Map<string, Set<string>>();
  const anchorsIn = (path: string) => {
    if (!anchors.has(path)) anchors.set(path, anchorsOf(files.get(path) ?? ""));
    return anchors.get(path) ?? new Set<string>();
  };
  const broken: string[] = [];
  for (const [file, markdown] of files) {
    for (const { line, n } of proseLines(markdown)) {
      for (const target of relativeTargets(line)) {
        const problem = linkProblem(file, target, exists, anchorsIn);
        if (problem) broken.push(`${file}:${n}: ${target} (${problem})`);
      }
    }
  }
  return broken;
}

/** The targets of the links in a prose line that point inside the repo: code spans and URLs left out. */
function relativeTargets(line: string): string[] {
  const text = line.replace(/`[^`]*`/g, "");
  return [...text.matchAll(/\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)]
    .map((m) => m[1] ?? "")
    .filter((target) => !/^[a-z][a-z0-9+.-]*:/i.test(target));
}

/** Why a link of `file` is broken (the file or the heading is missing), or null when it holds. */
function linkProblem(
  file: string,
  target: string,
  exists: (path: string) => boolean,
  anchorsIn: (path: string) => Set<string>,
): string | null {
  const [path = "", anchor] = target.split("#");
  const resolved = path === "" ? file : posix.normalize(posix.join(posix.dirname(file), path));
  if (path !== "" && !exists(resolved.replace(/\/$/, ""))) return `no file ${resolved}`;
  if (anchor && resolved.endsWith(".md") && !anchorsIn(resolved).has(anchor)) {
    return `no heading #${anchor} in ${resolved}`;
  }
  return null;
}

/** Every `docs/...md` path the code names that does not exist, as `file: path`. */
export function missingDocRefs(
  code: Map<string, string>,
  exists: (path: string) => boolean,
): string[] {
  const missing: string[] = [];
  for (const [file, source] of code) {
    for (const m of source.matchAll(/\bdocs\/\w[\w./-]*\.md\b/g)) {
      // A template name such as docs/SPEC-fase-N.md stands for every phase, not one file.
      if (m[0].endsWith("-N.md")) continue;
      if (!exists(m[0])) missing.push(`${file}: ${m[0]}`);
    }
  }
  return missing;
}
