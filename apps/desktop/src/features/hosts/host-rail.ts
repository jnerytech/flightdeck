/** The tip of a host in the collapsed rail: its name, then its version when it has one. */
export function hostRailLabel(name: string, version: string | null): string {
  return [name, version].filter((part) => part !== null).join(" · ");
}

/** The letter a host shows in the collapsed rail: the first character of its name, upper-cased. */
export function hostInitial(name: string): string {
  return [...name][0]?.toUpperCase() ?? "?";
}
