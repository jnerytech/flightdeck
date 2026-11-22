/** What the saved mutes name that the lists of hosts and projects no longer show. */
export interface UnlistedMutes {
  /** Muted host ids with no host in the list. */
  hosts: string[];
  /** Muted `hostId/projectId` keys with no project in the lists. */
  projects: string[];
}

/**
 * The host and project mutes the Settings lists cannot show: a host that was removed, a project of
 * a host that is offline (its projects are not loaded). They still silence, so the person must be
 * able to see and clear them.
 */
export function unlistedMutes(
  saved: Readonly<{ mutedHosts: readonly string[]; mutedProjects: readonly string[] }>,
  hosts: readonly { id: string }[],
  projects: Readonly<Record<string, readonly { id: string }[]>>,
): UnlistedMutes {
  const listedHosts = new Set(hosts.map((host) => host.id));
  const listedProjects = new Set(
    hosts.flatMap((host) => (projects[host.id] ?? []).map((project) => `${host.id}/${project.id}`)),
  );
  return {
    hosts: saved.mutedHosts.filter((id) => !listedHosts.has(id)),
    projects: saved.mutedProjects.filter((key) => !listedProjects.has(key)),
  };
}
