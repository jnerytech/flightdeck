import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { stableBinPath } from "../../src/service/domain/version.ts";
import {
  fdLauncherPath,
  fdLauncherText,
  fdPathNotes,
  installFdLauncher,
  setupFdLauncher,
} from "../../src/service/fd-launcher.ts";
import { tempDir } from "../support/helpers.ts";

const platform = process.platform;
const onUnix = platform === "win32" ? test.skip : test;

function home() {
  const dir = tempDir("fd-launcher-");
  const stable = stableBinPath(dir, platform);
  mkdirSync(join(dir, ".flightdeck", "bin"), { recursive: true });
  return { dir, stable, launcher: fdLauncherPath(stable, platform) };
}

describe("fd launcher: what the file says (#3433)", () => {
  test("on Linux and macOS it is a shell script named fd, beside the binary, that runs the binary's fd command", () => {
    const stable = "/home/dev/.flightdeck/bin/flightdeckd";
    expect(fdLauncherPath(stable, "linux")).toBe("/home/dev/.flightdeck/bin/fd");
    expect(fdLauncherText(stable, "linux")).toBe(
      `#!/bin/sh\n# flightdeck fd launcher\nexec '${stable}' fd "$@"\n`,
    );
  });

  test("a quote in the path cannot end the quoting of the script", () => {
    const text = fdLauncherText("/home/o'neil/.flightdeck/bin/flightdeckd", "linux");
    expect(text).toContain(String.raw`exec '/home/o'\''neil/.flightdeck/bin/flightdeckd' fd "$@"`);
  });

  test("on Windows it is fd.cmd, with CRLF lines and a percent sign doubled", () => {
    const stable = String.raw`C:\Users\100%dev\.flightdeck\bin\flightdeckd.exe`;
    expect(fdLauncherPath(stable, "win32")).toBe(
      String.raw`C:\Users\100%dev\.flightdeck\bin\fd.cmd`,
    );
    expect(fdLauncherText(stable, "win32")).toBe(
      `@echo off\r\nREM flightdeck fd launcher\r\n"C:\\Users\\100%%dev\\.flightdeck\\bin\\flightdeckd.exe" fd %*\r\n`,
    );
  });

  onUnix("run, it passes every argument to the binary's fd command, spaces kept", async () => {
    const { stable, launcher } = home();
    writeFileSync(stable, `#!/bin/sh\nfor a in "$@"; do echo "[$a]"; done\n`);
    chmodSync(stable, 0o755);
    await installFdLauncher(stable, platform);
    const run = Bun.spawn(["sh", "-c", '"$0" "$@" 2>&1', launcher, "claude", "two words", "--x"], {
      stdout: "pipe",
    });
    expect((await new Response(run.stdout).text()).trim().split("\n")).toEqual([
      "[fd]",
      "[claude]",
      "[two words]",
      "[--x]",
    ]);
  });
});

describe("fd launcher: installing it (#3433)", () => {
  test("with no fd there it is written, and it is executable", async () => {
    const { stable, launcher } = home();
    expect(await installFdLauncher(stable, platform)).toEqual({
      path: launcher,
      outcome: "written",
    });
    expect(readFileSync(launcher, "utf8")).toBe(fdLauncherText(stable, platform));
    if (platform !== "win32") expect(statSync(launcher).mode & 0o111).not.toBe(0);
  });

  test("setup run twice leaves our launcher as it is", async () => {
    const { stable, launcher } = home();
    await installFdLauncher(stable, platform);
    expect((await installFdLauncher(stable, platform)).outcome).toBe("same");
    expect(readFileSync(launcher, "utf8")).toBe(fdLauncherText(stable, platform));
  });

  test("our launcher that points at another binary is written again", async () => {
    const { stable, launcher } = home();
    writeFileSync(launcher, fdLauncherText(join(stable, "..", "old", "flightdeckd"), platform));
    expect((await installFdLauncher(stable, platform)).outcome).toBe("updated");
    expect(readFileSync(launcher, "utf8")).toBe(fdLauncherText(stable, platform));
  });

  test("an fd that is not ours stays untouched", async () => {
    const { stable, launcher } = home();
    writeFileSync(launcher, "#!/bin/sh\necho someone else's fd\n");
    expect((await installFdLauncher(stable, platform)).outcome).toBe("foreign");
    expect(readFileSync(launcher, "utf8")).toBe("#!/bin/sh\necho someone else's fd\n");
  });

  onUnix("a link called fd is foreign, and what it points at is not written", async () => {
    const { dir, stable, launcher } = home();
    const target = join(dir, "target.txt");
    writeFileSync(target, "keep\n");
    symlinkSync(target, launcher);
    expect((await installFdLauncher(stable, platform)).outcome).toBe("foreign");
    expect(readFileSync(target, "utf8")).toBe("keep\n");
  });

  test("a folder called fd is foreign too, not an error", async () => {
    const { stable, launcher } = home();
    mkdirSync(launcher);
    expect((await installFdLauncher(stable, platform)).outcome).toBe("foreign");
    expect(existsSync(launcher)).toBe(true);
  });
});

describe("fd launcher: what setup tells the person (#3433)", () => {
  const found = (path: string | null) => (name: string) => (name === "fd" ? path : null);

  test("an fd that is first on the PATH wins: setup names it and says how to put ours first", async () => {
    const { stable } = home();
    const lines = await setupFdLauncher({ stable, platform, which: found("/usr/bin/fd") });
    const text = lines.join("\n");
    expect(text).toContain("/usr/bin/fd");
    expect(text).toContain("first on your PATH");
    expect(text).toContain(`export PATH="${join(stable, "..")}:$PATH"`);
  });

  test("on Windows the line to put the folder first is for PowerShell", () => {
    const lines = fdPathNotes({
      launcher: String.raw`C:\Users\dev\.flightdeck\bin\fd.cmd`,
      platform: "win32",
      outcome: "written",
      found: String.raw`C:\tools\fd.exe`,
    });
    expect(lines.join("\n")).toContain(
      String.raw`[Environment]::SetEnvironmentVariable("Path", "C:\Users\dev\.flightdeck\bin;" + [Environment]::GetEnvironmentVariable("Path", "User"), "User")`,
    );
  });

  test("the first line says where the launcher went and what was done", async () => {
    const { stable, launcher } = home();
    const [first] = await setupFdLauncher({ stable, platform, which: found(null) });
    expect(first).toBe(`fd launcher: ${launcher} (written)`);
  });

  test("when our launcher is the fd the PATH finds, setup says nothing more", async () => {
    const { stable, launcher } = home();
    const lines = await setupFdLauncher({ stable, platform, which: found(launcher) });
    expect(lines.slice(1)).toEqual([]);
  });

  test("when no fd is on the PATH yet, setup says nothing more", async () => {
    const { stable } = home();
    const lines = await setupFdLauncher({ stable, platform, which: found(null) });
    expect(lines.slice(1)).toEqual([]);
  });

  test("a foreign fd in our folder is named, kept, and the way to claude is told", async () => {
    const { stable, launcher } = home();
    writeFileSync(launcher, "mine\n");
    const lines = await setupFdLauncher({ stable, platform, which: found(launcher) });
    expect(readFileSync(launcher, "utf8")).toBe("mine\n");
    expect(lines.join("\n")).toContain(`${launcher} is not Flightdeck's`);
    expect(lines.join("\n")).toContain("flightdeckd claude");
  });
});

describe("fd launcher: the manuals (#3433)", () => {
  const root = join(import.meta.dir, "..", "..", "..", "..");
  for (const lang of ["en", "pt-BR"]) {
    test(`${lang}: the claude chapter says fd and no longer suggests an alias for it`, () => {
      const text = readFileSync(
        join(root, "docs", "manual", lang, "flightdeckd-claude-and-the-channel.md"),
        "utf8",
      );
      expect(text).not.toContain('alias fd="flightdeckd claude"');
      expect(text).toContain("`fd`");
    });

    test(`${lang}: the commands chapter does not say the fd command is still to come`, () => {
      const text = readFileSync(
        join(root, "docs", "manual", lang, "flightdeckd-commands.md"),
        "utf8",
      );
      expect(text).not.toContain("until it ships");
      expect(text).not.toContain("até ele chegar");
      expect(text).not.toContain("#3433");
    });
  }
});
