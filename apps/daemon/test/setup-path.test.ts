import { describe, expect, test } from "bun:test";
import { addToUserPath, binDir, type PathEnv, removeFromUserPath } from "../src/user-path.ts";

const HOME = "C:\\Users\\dev";
const BIN = "C:\\Users\\dev\\.flightdeck\\bin";

/** A fake registry: `reg query` answers the stored value, `reg add` replaces it. */
function winEnv(initial: { value: string; type?: string } | null, fail: string[] = []) {
  const calls: string[][] = [];
  let stored = initial;
  const env: PathEnv = {
    platform: "win32",
    home: HOME,
    exec: async (cmd) => {
      calls.push(cmd);
      if (fail.includes(cmd[0] === "reg" ? (cmd[1] as string) : (cmd[0] as string))) {
        return { code: 1, stdout: "" };
      }
      if (cmd[0] === "reg" && cmd[1] === "query") {
        return stored
          ? {
              code: 0,
              stdout: `\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    ${stored.type ?? "REG_EXPAND_SZ"}    ${stored.value}\r\n\r\n`,
            }
          : { code: 1, stdout: "" };
      }
      if (cmd[0] === "reg" && cmd[1] === "add") {
        stored = {
          value: cmd[cmd.indexOf("/d") + 1] as string,
          type: cmd[cmd.indexOf("/t") + 1] as string,
        };
      }
      return { code: 0, stdout: "" };
    },
  };
  return { env, calls, stored: () => stored };
}

const writes = (calls: string[][]) => calls.filter((c) => c[0] === "reg" && c[1] === "add");
const broadcasts = (calls: string[][]) => calls.filter((c) => c[0] === "powershell");

describe("binDir", () => {
  test("is ~/.flightdeck/bin in the platform's own paths", () => {
    expect(
      binDir({ platform: "win32", home: HOME, exec: async () => ({ code: 0, stdout: "" }) }),
    ).toBe(BIN);
    expect(
      binDir({ platform: "linux", home: "/home/dev", exec: async () => ({ code: 0, stdout: "" }) }),
    ).toBe("/home/dev/.flightdeck/bin");
  });
});

describe("addToUserPath on Windows", () => {
  test("appends the folder to the user Path in the registry, broadcasts, and asks for a new terminal", async () => {
    const h = winEnv({ value: "C:\\Tools;C:\\Other" });
    const out = await addToUserPath(h.env, BIN);
    expect(h.stored()).toEqual({ value: `C:\\Tools;C:\\Other;${BIN}`, type: "REG_EXPAND_SZ" });
    expect(writes(h.calls)[0]?.slice(0, 5)).toEqual([
      "reg",
      "add",
      "HKCU\\Environment",
      "/v",
      "Path",
    ]);
    expect(broadcasts(h.calls)).toHaveLength(1);
    expect(h.calls.indexOf(broadcasts(h.calls)[0] as string[])).toBeGreaterThan(
      h.calls.indexOf(writes(h.calls)[0] as string[]),
    );
    expect(out.join("\n")).toContain("new terminal");
    expect(out.join("\n")).toContain(BIN);
  });

  test("a missing Path value is created with only the folder", async () => {
    const h = winEnv(null);
    await addToUserPath(h.env, BIN);
    expect(h.stored()).toEqual({ value: BIN, type: "REG_EXPAND_SZ" });
  });

  test("a value that ends with a semicolon gets no doubled one, and a REG_SZ stays REG_SZ", async () => {
    const h = winEnv({ value: "C:\\Tools;", type: "REG_SZ" });
    await addToUserPath(h.env, BIN);
    expect(h.stored()).toEqual({ value: `C:\\Tools;${BIN}`, type: "REG_SZ" });
  });

  test("a long Path is kept whole (setx would cut it at 1024 characters) and setx is never run", async () => {
    const long = Array.from({ length: 60 }, (_, i) => `C:\\Program Files\\Tool${i}\\bin`).join(";");
    const h = winEnv({ value: long });
    await addToUserPath(h.env, BIN);
    expect(h.stored()?.value).toBe(`${long};${BIN}`);
    expect(h.stored()?.value.length).toBeGreaterThan(1024);
    expect(h.calls.some((c) => c.join(" ").toLowerCase().includes("setx"))).toBe(false);
  });

  test.each([
    ["the same text", BIN],
    ["another case", BIN.toUpperCase()],
    ["a trailing backslash", `${BIN}\\`],
    ["forward slashes", BIN.replaceAll("\\", "/")],
    ["%USERPROFILE%", "%USERPROFILE%\\.flightdeck\\bin"],
  ])(
    "an entry that is already there (%s) changes nothing and broadcasts nothing",
    async (_name, entry) => {
      const h = winEnv({ value: `C:\\Tools;${entry};C:\\Other` });
      const out = await addToUserPath(h.env, BIN);
      expect(writes(h.calls)).toHaveLength(0);
      expect(broadcasts(h.calls)).toHaveLength(0);
      expect(out.join("\n")).toContain("already");
    },
  );

  test("a registry write that fails is reported with the manual step, not thrown", async () => {
    const h = winEnv({ value: "C:\\Tools" }, ["add"]);
    const out = await addToUserPath(h.env, BIN);
    expect(out.join("\n")).toContain("could not");
    expect(out.join("\n")).toContain(BIN);
    expect(broadcasts(h.calls)).toHaveLength(0);
  });

  test("a broadcast that fails keeps the entry and warns that a new login may be needed", async () => {
    const h = winEnv({ value: "C:\\Tools" }, ["powershell"]);
    const out = await addToUserPath(h.env, BIN);
    expect(h.stored()?.value).toBe(`C:\\Tools;${BIN}`);
    expect(out.join("\n")).toContain("sign out");
  });
});

describe("removeFromUserPath on Windows", () => {
  test("takes every spelling of the folder off and keeps the rest in order", async () => {
    const h = winEnv({ value: `C:\\Tools;${BIN};C:\\Other;%USERPROFILE%\\.flightdeck\\bin\\` });
    const out = await removeFromUserPath(h.env, BIN);
    expect(h.stored()).toEqual({ value: "C:\\Tools;C:\\Other", type: "REG_EXPAND_SZ" });
    expect(broadcasts(h.calls)).toHaveLength(1);
    expect(out.join("\n")).toContain("removed");
  });

  test("a Path without the folder, or no Path at all, is left alone", async () => {
    for (const initial of [{ value: "C:\\Tools" }, null]) {
      const h = winEnv(initial);
      await removeFromUserPath(h.env, BIN);
      expect(writes(h.calls)).toHaveLength(0);
      expect(broadcasts(h.calls)).toHaveLength(0);
    }
  });

  test("a failed write is reported, not thrown", async () => {
    const h = winEnv({ value: BIN }, ["add"]);
    const out = await removeFromUserPath(h.env, BIN);
    expect(out.join("\n")).toContain("could not");
  });
});

describe("other platforms", () => {
  const unix = (platform: string) => {
    const calls: string[][] = [];
    const env: PathEnv = {
      platform,
      home: "/home/dev",
      exec: async (cmd) => {
        calls.push(cmd);
        return { code: 0, stdout: "" };
      },
    };
    return { env, calls };
  };

  test.each(["linux", "darwin"])(
    "%s prints the line to add and edits nothing",
    async (platform) => {
      const h = unix(platform);
      const out = await addToUserPath(h.env, "/home/dev/.flightdeck/bin");
      expect(h.calls).toEqual([]);
      expect(out.join("\n")).toContain('export PATH="/home/dev/.flightdeck/bin:$PATH"');
    },
  );

  /** A home with files in memory: what `~/.profile` holds, and what was written to it. */
  const withProfile = (initial: string | null, failWrite = false) => {
    const files = new Map<string, string>(
      initial === null ? [] : [["/home/dev/.profile", initial]],
    );
    const env: PathEnv = {
      platform: "linux",
      home: "/home/dev",
      exec: async () => ({ code: 0, stdout: "" }),
      readFile: async (path) => files.get(path) ?? null,
      writeFile: async (path, content) => {
        if (failWrite) throw new Error("read-only");
        files.set(path, content);
      },
    };
    return { env, files };
  };
  const BIN_LINE = 'export PATH="/home/dev/.flightdeck/bin:$PATH"';
  const count = (text: string | undefined) => (text ?? "").split(BIN_LINE).length - 1;

  test("linux appends the folder to ~/.profile, keeping what was there, and asks for a new terminal", async () => {
    const h = withProfile("# mine\nexport EDITOR=vim\n");
    const out = await addToUserPath(h.env, "/home/dev/.flightdeck/bin");
    const profile = h.files.get("/home/dev/.profile");
    expect(profile?.startsWith("# mine\nexport EDITOR=vim\n")).toBe(true);
    expect(count(profile)).toBe(1);
    expect(out.join("\n")).toContain(".profile");
    expect(out.join("\n")).toContain("new terminal");
  });

  test("linux creates ~/.profile when there is none, and a second setup adds nothing", async () => {
    const h = withProfile(null);
    await addToUserPath(h.env, "/home/dev/.flightdeck/bin");
    const once = h.files.get("/home/dev/.profile");
    expect(count(once)).toBe(1);
    const out = await addToUserPath(h.env, "/home/dev/.flightdeck/bin");
    expect(h.files.get("/home/dev/.profile")).toBe(once);
    expect(out.join("\n")).toContain("already");
  });

  test("linux leaves a profile that already has the folder untouched", async () => {
    const own = `# mine\n${BIN_LINE}\n`;
    const h = withProfile(own);
    await addToUserPath(h.env, "/home/dev/.flightdeck/bin");
    expect(h.files.get("/home/dev/.profile")).toBe(own);
  });

  test("linux that cannot write the profile says how to do it by hand, and does not throw", async () => {
    const h = withProfile("", true);
    const out = await addToUserPath(h.env, "/home/dev/.flightdeck/bin");
    expect(out.join("\n")).toContain(BIN_LINE);
  });

  test("remove prints nothing and runs nothing", async () => {
    const h = unix("linux");
    expect(await removeFromUserPath(h.env, "/home/dev/.flightdeck/bin")).toEqual([]);
    expect(h.calls).toEqual([]);
  });
});
