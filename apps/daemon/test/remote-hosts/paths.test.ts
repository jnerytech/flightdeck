import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  APP_IDENTIFIER,
  helperCandidates,
  hostIndexPath,
} from "../../src/remote-hosts/domain/paths.ts";

describe("remote hosts: where the app keeps the name index (#3429)", () => {
  test("the identifier is the one tauri.conf.json gives the app", async () => {
    const conf = await Bun.file(
      join(import.meta.dir, "../../../desktop/src-tauri/tauri.conf.json"),
    ).json();
    expect(APP_IDENTIFIER).toBe(conf.identifier);
  });

  test("Linux: under XDG_CONFIG_HOME, else under ~/.config", () => {
    const base = { platform: "linux", home: "/home/ana", execPath: "/opt/fd/flightdeckd" };
    expect(hostIndexPath({ ...base, xdgConfigHome: "/cfg" })).toBe(
      `/cfg/${APP_IDENTIFIER}/hosts.json`,
    );
    expect(hostIndexPath(base)).toBe(`/home/ana/.config/${APP_IDENTIFIER}/hosts.json`);
  });

  test("macOS: under Application Support", () => {
    expect(
      hostIndexPath({ platform: "darwin", home: "/Users/ana", execPath: "/x/flightdeckd" }),
    ).toBe(`/Users/ana/Library/Application Support/${APP_IDENTIFIER}/hosts.json`);
  });

  test("Windows: under %APPDATA%", () => {
    expect(
      hostIndexPath({
        platform: "win32",
        home: "C:\\Users\\ana",
        appData: "C:\\Users\\ana\\AppData\\Roaming",
        execPath: "C:\\fd\\flightdeckd.exe",
      }),
    ).toBe(`C:\\Users\\ana\\AppData\\Roaming\\${APP_IDENTIFIER}\\hosts.json`);
  });
});

describe("remote hosts: where the credential helper may be (#3429)", () => {
  test("Linux: beside flightdeckd, and nowhere else", () => {
    expect(
      helperCandidates({ platform: "linux", home: "/home/ana", execPath: "/opt/fd/flightdeckd" }),
    ).toEqual(["/opt/fd/flightdeck-cred"]);
  });

  test("macOS: beside flightdeckd, then inside the installed app", () => {
    expect(
      helperCandidates({ platform: "darwin", home: "/Users/ana", execPath: "/x/flightdeckd" }),
    ).toEqual([
      "/x/flightdeck-cred",
      "/Applications/Flightdeck.app/Contents/MacOS/flightdeck-cred",
    ]);
  });

  test("Windows: beside flightdeckd, then in the per-user install folder; the helper is an .exe", () => {
    expect(
      helperCandidates({
        platform: "win32",
        home: "C:\\Users\\ana",
        localAppData: "C:\\Users\\ana\\AppData\\Local",
        execPath: "C:\\fd\\flightdeckd.exe",
      }),
    ).toEqual([
      "C:\\fd\\flightdeck-cred.exe",
      "C:\\Users\\ana\\AppData\\Local\\Programs\\flightdeck\\flightdeck-cred.exe",
    ]);
  });

  test("Windows without LOCALAPPDATA has only the place beside flightdeckd", () => {
    expect(
      helperCandidates({ platform: "win32", home: "C:\\u", execPath: "C:\\fd\\flightdeckd.exe" }),
    ).toEqual(["C:\\fd\\flightdeck-cred.exe"]);
  });
});
