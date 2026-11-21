/** Issue #3617: what `flightdeckd agentcfg` prints, as pure functions of what the daemon answered. */
import type { AgentCfgItem } from "@flightdeck/protocol";

type AgentCfgKind = AgentCfgItem["kind"];

/** An item with every key a script reads: a name or description the file has none of is `null`. */
export const withNulls = (item: AgentCfgItem) => ({
  ...item,
  name: item.name ?? null,
  description: item.description ?? null,
});

const access = (item: AgentCfgItem) => (item.readOnly ? "read-only" : "editable");

/** A file as one line: path, origin, access, hash, and its name and description when it has them. */
const itemLine = (item: AgentCfgItem): string =>
  [item.path, item.origin, access(item), item.hash, item.name, item.description]
    .filter((part) => part !== undefined)
    .join("  ");

export const listLines = (kind: AgentCfgKind, items: readonly AgentCfgItem[]): string[] =>
  items.length === 0 ? [`no ${kind} files`] : items.map(itemLine);

/** The file's identity and hash, a blank line, and its content: the hash is what a write repeats. */
export const readLines = (item: AgentCfgItem, content: string): string[] => [
  `${item.path}  ${item.origin}  ${access(item)}`,
  `hash: ${item.hash}`,
  "",
  ...content.split("\n"),
];

export const wroteLine = (kind: AgentCfgKind, path: string, hash: string): string =>
  `wrote ${path} (${kind})  hash: ${hash}`;
