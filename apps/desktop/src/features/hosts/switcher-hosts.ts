/**
 * The hosts the switcher shows (#932): every host with "Tabs of all hosts" or with no host chosen,
 * else only the chosen one. What lists a host's places (projects) follows it, so picking a host and
 * opening a project never lands on another host.
 */
export function switcherHosts<T extends { id: string }>(
  hosts: readonly T[],
  scope: "host" | "all",
  hostId: string | null,
): T[] {
  // A host the list does not have (none chosen yet, or removed) means every host.
  if (scope === "all" || !hosts.some((host) => host.id === hostId)) return [...hosts];
  return hosts.filter((host) => host.id === hostId);
}
