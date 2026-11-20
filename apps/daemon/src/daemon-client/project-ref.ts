/**
 * Issue #3457: a project as a terminal names it. The commands that act on one project take its id or
 * its name; an id wins, a name matches without regard to case, and a name that two projects share is
 * refused with the ids, never guessed. Without a name, a host with one project means that one.
 */
import { type CliResult, failure } from "./cli-view.ts";

export type ProjectRef = { id: string; name: string } | { refusal: CliResult };

const names = (projects: ReadonlyArray<{ name: string }>) => projects.map((p) => p.name).join(", ");

export function resolveProject(
  projects: ReadonlyArray<{ id: string; name: string }>,
  ref: string | undefined,
): ProjectRef {
  if (ref === undefined) {
    const [only] = projects;
    if (only && projects.length === 1) return { id: only.id, name: only.name };
    return {
      refusal: failure(
        1,
        projects.length === 0
          ? "this host has no projects yet"
          : `this host has several projects: pass --project <name or id> (${names(projects)})`,
      ),
    };
  }
  const byId = projects.find((p) => p.id === ref);
  if (byId) return { id: byId.id, name: byId.name };
  const named = projects.filter((p) => p.name.toLowerCase() === ref.toLowerCase());
  const [first] = named;
  if (first && named.length === 1) return { id: first.id, name: first.name };
  if (first)
    return {
      refusal: failure(
        1,
        `"${ref}" is the name of several projects: use the id (${named.map((p) => p.id).join(", ")})`,
      ),
    };
  return {
    refusal: failure(1, `no project named "${ref}"; the projects here: ${names(projects)}`),
  };
}
