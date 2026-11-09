import { describe, expect, test } from "bun:test";
import { keepNewest } from "../src/lib/backup-target.ts";
import { DriveError, driveTarget } from "../src/lib/drive-target.ts";
import { fakeDrive } from "./fake-google.ts";

/**
 * Issue #1444: the Drive target keeps the already-encrypted bundle in the app's own hidden folder
 * (appDataFolder), uploads it resumably and lists, reads and removes by name. A fake Drive stands in:
 * nothing real is touched.
 */
const NAME = (day: number) =>
  `flightdeck-backup-202611${String(day).padStart(2, "0")}-120000.fdbackup`;

function signedIn(accept: string[] = ["good"]) {
  const drive = fakeDrive();
  drive.accept = new Set(accept);
  const asked: boolean[] = [];
  const target = driveTarget({
    fetch: drive.fetch,
    auth: {
      token: async (refresh) => {
        asked.push(refresh === true);
        return refresh ? "fresh" : "good";
      },
    },
  });
  return { drive, target, asked };
}

describe("driveTarget", () => {
  test("puts the bundle in the app data folder with a resumable upload", async () => {
    const { drive, target } = signedIn();
    await target.put(NAME(1), "cipher-1");
    const [file] = [...drive.files.values()];
    expect(file).toEqual({ name: NAME(1), parents: ["appDataFolder"], text: "cipher-1" });
    const methods = drive.calls.map(
      (call) => `${call.method} ${new URL(call.url).searchParams.get("uploadType") ?? "session"}`,
    );
    expect(methods).toEqual(["POST resumable", "PUT session"]);
  });

  test("sends the token to Drive's API but not to the upload session address", async () => {
    const { drive, target } = signedIn();
    await target.put(NAME(1), "cipher");
    expect(drive.calls[0]?.auth).toBe("Bearer good");
    expect(drive.calls[1]?.auth).toBeNull();
  });

  test("lists the names across pages", async () => {
    const { drive, target } = signedIn();
    drive.pageSize = 2;
    for (const day of [1, 2, 3]) await target.put(NAME(day), `c${day}`);
    const names = await target.list();
    expect(names.sort((a, b) => a.localeCompare(b))).toEqual([NAME(1), NAME(2), NAME(3)]);
  });

  test("reads a backup back by name and says not-found for one that is not there", async () => {
    const { target } = signedIn();
    await target.put(NAME(1), "cipher-1");
    expect(await target.get(NAME(1))).toBe("cipher-1");
    const missing = await target.get(NAME(2)).catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(DriveError);
    expect((missing as DriveError).kind).toBe("not-found");
  });

  test("removes a backup by name", async () => {
    const { drive, target } = signedIn();
    await target.put(NAME(1), "a");
    await target.put(NAME(2), "b");
    await target.remove(NAME(1));
    expect([...drive.files.values()].map((file) => file.name)).toEqual([NAME(2)]);
  });

  test("keepNewest keeps the last N on Drive", async () => {
    const { drive, target } = signedIn();
    for (const day of [1, 2, 3, 4]) await target.put(NAME(day), `c${day}`);
    expect(await keepNewest(target, 2, NAME(4))).toEqual({ ok: true, kept: 2, removed: 2 });
    expect(
      [...drive.files.values()].map((file) => file.name).sort((a, b) => a.localeCompare(b)),
    ).toEqual([NAME(3), NAME(4)]);
  });

  test("on a 401 asks for a fresh token once and retries with it", async () => {
    const { drive, target, asked } = signedIn(["fresh"]);
    await target.put(NAME(1), "cipher");
    expect(asked).toEqual([false, true]);
    expect(drive.calls.filter((call) => call.auth === "Bearer fresh").length).toBeGreaterThan(0);
    expect(drive.files.size).toBe(1);
  });

  test("a token refused after the refresh is an auth failure and is not tried again", async () => {
    const { drive, target, asked } = signedIn([]);
    const failure = await target.list().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(DriveError);
    expect((failure as DriveError).kind).toBe("auth");
    expect(asked).toEqual([false, true]);
    expect(drive.calls.length).toBe(2);
  });

  test("an error carries the status, never the token", async () => {
    const { drive, target } = signedIn();
    await target.put(NAME(1), "a");
    drive.accept = new Set(["good"]);
    const failure = await target.get(NAME(9)).catch((e: unknown) => e);
    expect(failure instanceof DriveError).toBe(true);
    const message = failure instanceof Error ? failure.message : "";
    expect(message).toContain("not-found");
    expect(message).not.toContain("good");
    expect(message).not.toContain("Bearer");
  });

  test("refuses an upload address that is not Google's and sends nothing there", async () => {
    for (const host of [
      "https://evil.example",
      "https://www.googleapis.com.evil.example",
      "http://www.googleapis.com",
    ]) {
      const drive = fakeDrive({ sessionHost: host });
      const target = driveTarget({ fetch: drive.fetch, auth: { token: async () => "good" } });
      const failure = await target.put(NAME(1), "cipher").catch((e: unknown) => e);
      expect(failure instanceof DriveError && failure.kind).toBe("upload");
      expect(drive.calls.some((call) => call.url.startsWith(host))).toBe(false);
      expect(drive.files.size).toBe(0);
    }
  });
});
