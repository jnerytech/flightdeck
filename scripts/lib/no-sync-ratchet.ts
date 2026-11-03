/**
 * Runtime code never blocks on IO. This counts the synchronous node/Bun calls per file; the test
 * compares them with `SYNC_BASELINE`, which only goes down (a file leaves it at zero).
 */
const FS_NAMES = [
  "access",
  "appendFile",
  "chmod",
  "chown",
  "close",
  "copyFile",
  "cp",
  "exists",
  "fstat",
  "lstat",
  "mkdir",
  "mkdtemp",
  "open",
  "opendir",
  "read",
  "readdir",
  "readFile",
  "readlink",
  "realpath",
  "rename",
  "rm",
  "rmdir",
  "stat",
  "statfs",
  "symlink",
  "truncate",
  "unlink",
  "utimes",
  "write",
  "writeFile",
];
const BLOCKING = new RegExp(
  `\\b(?:(?:${FS_NAMES.join("|")})Sync|execSync|execFileSync|spawnSync)\\s*\\(`,
  "g",
);

/** Number of blocking calls in one source file (comment lines are ignored). */
export function syncCallCount(source: string): number {
  return source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .reduce((total, line) => total + (line.match(BLOCKING)?.length ?? 0), 0);
}

export const SYNC_BASELINE: Record<string, number> = {
  "apps/daemon/src/actions/run.ts": 3,
  "apps/daemon/src/actions/shell.ts": 3,
  "apps/daemon/src/actions/trust.ts": 4,
  "apps/daemon/src/agentcfg/files.ts": 13,
  "apps/daemon/src/agentcfg/mcp.ts": 4,
  "apps/daemon/src/board/board.ts": 1,
  "apps/daemon/src/board/diff.ts": 1,
  "apps/daemon/src/central/central.ts": 3,
  "apps/daemon/src/central/external.ts": 1,
  "apps/daemon/src/central/hooks-install.ts": 6,
  "apps/daemon/src/central/wrapper.ts": 10,
  "apps/daemon/src/checkpoints/rewind.ts": 3,
  "apps/daemon/src/checkpoints/snapshots.ts": 5,
  "apps/daemon/src/config.ts": 10,
  "apps/daemon/src/costs/statusline.ts": 2,
  "apps/daemon/src/costs/usage-indexer.ts": 8,
  "apps/daemon/src/fs-dirs.ts": 4,
  "apps/daemon/src/history/indexer.ts": 6,
  "apps/daemon/src/lock.ts": 7,
  "apps/daemon/src/main.ts": 3,
  "apps/daemon/src/maintenance/backup.ts": 12,
  "apps/daemon/src/maintenance/maintenance.ts": 3,
  "apps/daemon/src/messaging/endpoints.ts": 1,
  "apps/daemon/src/paths.ts": 1,
  "apps/daemon/src/personas/store.ts": 8,
  "apps/daemon/src/plugins/inventory.ts": 19,
  "apps/daemon/src/plugins/plugins.ts": 7,
  "apps/daemon/src/review/changes.ts": 1,
  "apps/daemon/src/review/comments.ts": 2,
  "apps/daemon/src/review/files.ts": 18,
  "apps/daemon/src/roots.ts": 1,
  "apps/daemon/src/runtime/claude-sdk-runtime.ts": 1,
  "apps/daemon/src/service-os.ts": 5,
  "apps/daemon/src/setup.ts": 5,
  "apps/daemon/src/snippets/history.ts": 6,
  "apps/daemon/src/snippets/store.ts": 4,
  "apps/daemon/src/ssh/askpass.ts": 5,
  "apps/daemon/src/ssh/connect.ts": 3,
  "apps/daemon/src/ssh/import.ts": 1,
  "apps/daemon/src/ssh/key-delivery.ts": 5,
  "apps/daemon/src/store/event-store.ts": 1,
  "apps/daemon/src/telemetry/otlp-env.ts": 7,
  "apps/daemon/src/telemetry/service.ts": 4,
  "apps/daemon/src/update.ts": 9,
  "apps/daemon/src/updates/apply.ts": 4,
  "apps/daemon/src/workflows/check-runner.ts": 2,
  "apps/daemon/src/wsl.ts": 3,
};
