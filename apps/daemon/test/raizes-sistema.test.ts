import { describe, expect, test } from "bun:test";
import { isSystemFolder, type PlatformInfo } from "../src/roots.ts";

const win: PlatformInfo = {
  platform: "win32",
  home: "C:\\Users\\dev",
  env: {
    SystemDrive: "C:",
    SystemRoot: "C:\\Windows",
    APPDATA: "C:\\Users\\dev\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
  },
};
const linux: PlatformInfo = { platform: "linux", home: "/home/dev", env: {} };

describe("system folders on Windows", () => {
  test.each([
    "C:\\",
    "D:\\",
    "C:\\Windows",
    "C:\\Windows\\System32",
    "C:\\Program Files",
    "C:\\Program Files\\Git",
    "C:\\Program Files (x86)\\Foo",
    "C:\\ProgramData",
    "C:\\ProgramData\\x",
    "C:\\Users\\dev\\AppData",
    "C:\\Users\\dev\\AppData\\Local\\Temp",
    "C:\\Users\\dev\\AppData\\Roaming\\Code",
    "C:\\Users\\dev",
    "C:\\Users\\dev\\.ssh",
    "C:\\Users\\dev\\.claude\\projects",
  ])("%s is refused", async (path) => {
    expect(await isSystemFolder(path, win)).toBe(true);
  });

  test("the compare ignores case and the kind of slash", async () => {
    expect(await isSystemFolder("c:/windows/system32", win)).toBe(true);
    expect(await isSystemFolder("C:/PROGRAM FILES/x", win)).toBe(true);
    expect(await isSystemFolder("c:\\users\\DEV\\appdata\\local", win)).toBe(true);
    expect(await isSystemFolder("C:\\Users\\dev\\.SSH", win)).toBe(true);
  });

  test.each([
    "D:\\myVault",
    "C:\\work\\proj",
    "C:\\Users\\dev\\Documents\\vault",
    "C:\\Users\\dev\\repos\\flightdeck",
    "C:\\Windows-backup",
    "C:\\Program Files Extra",
  ])("%s is a normal folder", async (path) => {
    expect(await isSystemFolder(path, win)).toBe(false);
  });

  test("a drive other than the system's keeps no system folders", async () => {
    expect(await isSystemFolder("D:\\Windows", win)).toBe(false);
  });
});

describe("system folders elsewhere", () => {
  test.each([
    "/",
    "/etc",
    "/etc/ssh",
    "/usr/local",
    "/home/dev",
    "/home/dev/.ssh",
    "/home/dev/.claude",
  ])("%s is refused", async (path) => {
    expect(await isSystemFolder(path, linux)).toBe(true);
  });

  test.each(["/home/dev/vault", "/srv/proj", "/home/dev/repos/x", "/etcetera"])(
    "%s is a normal folder",
    async (path) => {
      expect(await isSystemFolder(path, linux)).toBe(false);
    },
  );

  test("the case of a path matters on Linux", async () => {
    expect(await isSystemFolder("/ETC", linux)).toBe(false);
  });
});

describe("the platform a test gives", () => {
  const runnerTemp = "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\fd-vault-x";
  const runner: PlatformInfo = {
    platform: "win32",
    home: "C:\\Users\\runneradmin",
    env: { LOCALAPPDATA: "C:\\Users\\runneradmin\\AppData\\Local" },
  };

  test("a Windows runner's temp folder is inside AppData, which the real rule refuses", async () => {
    expect(await isSystemFolder(runnerTemp, runner)).toBe(true);
  });

  test("with the neutral platform of the tests the same folder is allowed, but Windows itself is not", async () => {
    const neutral: PlatformInfo = { platform: "win32", env: {}, home: "Z:\\no-home" };
    expect(await isSystemFolder(runnerTemp, neutral)).toBe(false);
    expect(await isSystemFolder("C:\\Windows", neutral)).toBe(true);
  });
});
