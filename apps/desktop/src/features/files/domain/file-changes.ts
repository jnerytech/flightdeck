import type { DiffFile } from "@flightdeck/protocol";

/** The folders above a path, the repository's root (`""`) first: `a/b/c.md` is `""`, `a`, `a/b`. */
const above = (path: string): string[] => {
  const parts = path.split("/");
  return parts.map((_, i) => parts.slice(0, i).join("/"));
};

/**
 * The folders whose listing a change of the diff can alter (issue #574): the ones above each file
 * that came into the diff, left it, or changed its status, and above the old name of a rename.
 * A diff that says the same as before alters none.
 */
export function affectedDirs(before: DiffFile[], after: DiffFile[]): string[] {
  const key = (file: DiffFile) => `${file.status}:${file.path}`;
  const was = new Set(before.map(key));
  const is = new Set(after.map(key));
  const moved = [...before, ...after].filter((file) => !(was.has(key(file)) && is.has(key(file))));
  return [
    ...new Set(
      moved.flatMap((file) => [file.path, ...(file.oldPath ? [file.oldPath] : [])].flatMap(above)),
    ),
  ];
}
