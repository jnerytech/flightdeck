/**
 * The YAML between the leading `---` lines; null when there is none or it does not parse. YAML
 * that is not a mapping (empty, a list, a bare text) has no `name`, so it is refused all the same.
 */
export function frontmatter(text: string): Record<string, unknown> | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return null;
  try {
    return Bun.YAML.parse(match[1] as string) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}
