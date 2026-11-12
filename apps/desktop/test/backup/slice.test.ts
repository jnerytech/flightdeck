import { describe, expect, test } from "bun:test";
import type { RestorePreview, RestoreResult } from "../../src/features/backup/backup-bundle.ts";
import { BackupError } from "../../src/features/backup/backup-error.ts";
import { DriveError } from "../../src/features/backup/drive-target.ts";
import { type BackupCore, BackupSlice } from "../../src/features/backup/index.ts";

const PREVIEW = { token: "p" } as unknown as RestorePreview;
const RESULT = { restored: 1 } as unknown as RestoreResult;
const NAME = (n: number) => `flightdeck-backup-20261110-00000${n}.fdbackup`;

/** A slice over a stand-in core: each part answers as `over` says, and the calls are written down. */
function slice(over: Partial<BackupCore> = {}) {
  const saved: Array<{ name: string; text: string }> = [];
  const failed: unknown[] = [];
  const core: BackupCore = {
    createText: async () => "armored",
    saveFile: async (name, text) => {
      saved.push({ name, text });
      return true;
    },
    pickFile: async () => ({ text: "picked" }),
    previewText: async () => PREVIEW,
    applyPreview: async () => RESULT,
    driveNames: async () => [],
    driveText: async () => "drive text",
    fail: (error) => {
      failed.push(error);
    },
    ...over,
  };
  return { backup: new BackupSlice(core), saved, failed };
}

describe("backup slice: the whole-app backup", () => {
  test("create saves the armored text as one file, and a cancelled dialog is a reason, not a save", async () => {
    const ok = slice();
    expect(await ok.backup.create("pass", "pass")).toEqual({ ok: true });
    expect(ok.saved).toEqual([{ name: "flightdeck-backup.fdbackup", text: "armored" }]);
    const cancelled = slice({ saveFile: async () => false });
    expect(await cancelled.backup.create("pass", "pass")).toEqual({ ok: false, code: "cancelled" });
  });

  test("create refuses a file the restore could not pick again, and saves nothing", async () => {
    const s = slice({ createText: async () => "x".repeat(1024 * 1024 + 1) });
    expect(await s.backup.create("pass", "pass")).toEqual({ ok: false, code: "too-big" });
    expect(s.saved).toEqual([]);
  });

  test("a BackupError answers with its own code, and any other failure is told and answered as unexpected", async () => {
    const refused = slice({
      createText: async () => {
        throw new BackupError("mismatch");
      },
    });
    expect(await refused.backup.create("a", "b")).toEqual({ ok: false, code: "mismatch" });
    expect(refused.failed).toEqual([]);
    const broken = new Error("disk");
    const unexpected = slice({
      saveFile: async () => {
        throw broken;
      },
    });
    expect(await unexpected.backup.create("pass", "pass")).toEqual({
      ok: false,
      code: "unexpected",
    });
    expect(unexpected.failed).toEqual([broken]);
  });

  test("preview reads the picked file, and a cancelled picker previews nothing", async () => {
    const read: string[] = [];
    const s = slice({
      previewText: async (text) => {
        read.push(text);
        return PREVIEW;
      },
    });
    expect(await s.backup.preview("pass")).toEqual({ ok: true, preview: PREVIEW });
    expect(read).toEqual(["picked"]);
    const none = slice({ pickFile: async () => null });
    expect(await none.backup.preview("pass")).toEqual({ ok: false, code: "cancelled" });
  });

  test("driveList keeps only the backup names, newest first, and tells a lost sign-in from a failed read", async () => {
    const s = slice({ driveNames: async () => [NAME(1), "notes.txt", NAME(3), NAME(2)] });
    expect(await s.backup.driveList()).toEqual({ ok: true, names: [NAME(3), NAME(2), NAME(1)] });
    const auth = slice({
      driveNames: async () => {
        throw new DriveError("auth", 401);
      },
    });
    expect(await auth.backup.driveList()).toEqual({ ok: false, code: "drive-auth" });
    const down = slice({
      driveNames: async () => {
        throw new Error("offline");
      },
    });
    expect(await down.backup.driveList()).toEqual({ ok: false, code: "drive-failed" });
  });

  test("previewDrive refuses a Drive file over the limit before reading it, and restore tells only a failure that is not a BackupError", async () => {
    const big = slice({ driveText: async () => "x".repeat(1024 * 1024 + 1) });
    expect(await big.backup.previewDrive(NAME(1), "pass")).toEqual({ ok: false, code: "too-big" });
    const ok = slice();
    expect(await ok.backup.previewDrive(NAME(1), "pass")).toEqual({ ok: true, preview: PREVIEW });
    expect(await ok.backup.restore(PREVIEW, "skip")).toEqual({ ok: true, result: RESULT });
    const used = slice({
      applyPreview: async () => {
        throw new BackupError("unreadable");
      },
    });
    expect(await used.backup.restore(PREVIEW, "skip")).toEqual({ ok: false });
    expect(used.failed).toEqual([]);
    const broken = new Error("boom");
    const failing = slice({
      applyPreview: async () => {
        throw broken;
      },
    });
    expect(await failing.backup.restore(PREVIEW, "skip")).toEqual({ ok: false });
    expect(failing.failed).toEqual([broken]);
  });
});
