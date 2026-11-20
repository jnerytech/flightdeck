/** Issue #3537: what `flightdeckd ssh list|import preview|import apply|remove` print, as pure rules over the daemon's answers. */
import type { SshImportEntry, SshImportResult, SshTarget } from "@flightdeck/protocol";

/** One line per target, or a sentence when there is none; the vault secret is named by its id, never shown. */
export function targetLines(targets: SshTarget[]): string[] {
  if (targets.length === 0) return ["no ssh target"];
  return targets.map((t) => {
    const parts = [
      t.name,
      t.id,
      `${t.user}@${t.host}:${t.port}`,
      t.auth,
      `host key: ${t.hostKey ?? "not pinned"}`,
    ];
    if (t.viaHost !== null) parts.push(`via: ${t.viaHost}`);
    if (t.jump !== null) parts.push(`jump: ${t.jump}`);
    if (t.secretRef !== null) parts.push(`secret: ${t.secretRef}`);
    if (t.tags.length > 0) parts.push(`tags: ${t.tags.join(", ")}`);
    return parts.join("  ");
  });
}

/** One line per name `~/.ssh/config` would turn into a target, or a sentence when there is none. */
export function importLines(entries: SshImportEntry[]): string[] {
  if (entries.length === 0) return ["no host in ~/.ssh/config"];
  return entries.map((e) => {
    const parts = [e.alias, `${e.user}@${e.host}:${e.port}`];
    if (e.identityFile !== null) parts.push(`key: ${e.identityFile}`);
    if (e.proxyJump !== null) parts.push(`jump: ${e.proxyJump}`);
    if (e.exists) parts.push("already registered");
    return parts.join("  ");
  });
}

/** One line per name `import apply` created or skipped, with the reason the daemon gave. */
export function importResultLines(result: SshImportResult): string[] {
  return [
    ...result.created.map((t) => `${t.name}: imported as ${t.id}`),
    ...result.skipped.map((s) => `${s.alias}: skipped, ${s.reason}`),
  ];
}

export const removedLine = (name: string) => `${name}: removed`;
