import { describe, expect, test } from "bun:test";
import { chmodSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { locateHelper, readCredential } from "../../src/remote-hosts/credential-helper.ts";
import { tempDir } from "../support/helpers.ts";

const ID = "0b9f3c2e-4f4a-4c53-9d0b-6a7d1e5c8f10";
const TOKEN = "tok-AbCdEf0123456789-secret-value";
const URL_TEXT = "wss://example.com:7420/v1/ws";
const me = process.getuid?.() ?? null;
const posix = { platform: "linux", uid: me };

/** A folder with a `flightdeck-cred` file in it, with the folder's mode. */
function helperIn(mode = 0o755) {
  const dir = tempDir("fd-helper-");
  const file = join(dir, "flightdeck-cred");
  writeFileSync(file, "#!/bin/sh\n");
  chmodSync(file, 0o755);
  chmodSync(dir, mode);
  return { dir, file };
}

describe.skipIf(me === null)("remote hosts: where the helper may be run from (#3429)", () => {
  test("a helper in the user's own folder is found", async () => {
    const { file } = helperIn();
    expect(await locateHelper([file], posix)).toBe(file);
  });

  test("a folder that others can write to is refused: a swapped helper would read the token", async () => {
    for (const mode of [0o777, 0o775, 0o757]) {
      const { file } = helperIn(mode);
      expect({ mode, found: await locateHelper([file], posix) }).toEqual({ mode, found: null });
    }
  });

  test("a folder of another user is refused", async () => {
    const { file } = helperIn();
    expect(await locateHelper([file], { platform: "linux", uid: (me ?? 0) + 1 })).toBeNull();
  });

  test("a folder that is a link is refused", async () => {
    const { dir, file } = helperIn();
    const link = join(tempDir("fd-helper-link-"), "folder");
    symlinkSync(dir, link);
    expect(await locateHelper([join(link, "flightdeck-cred")], posix)).toBeNull();
    expect(await locateHelper([file], posix)).toBe(file);
  });

  test("a helper that is itself a link is refused", async () => {
    const real = helperIn().file;
    const folder = tempDir("fd-helper-file-link-");
    symlinkSync(real, join(folder, "flightdeck-cred"));
    expect(await locateHelper([join(folder, "flightdeck-cred")], posix)).toBeNull();
  });

  test("a missing helper is null, and the next good place is used when the first is refused", async () => {
    const bad = helperIn(0o777);
    const good = helperIn();
    expect(await locateHelper([join(tempDir("fd-none-"), "flightdeck-cred")], posix)).toBeNull();
    expect(await locateHelper([bad.file, good.file], posix)).toBe(good.file);
  });

  test("no candidate is no helper", async () => {
    expect(await locateHelper([], posix)).toBeNull();
  });
});

/** A fake helper: answers `get` with the token and `url` with the address, and remembers every command line. */
function fakeHelper(over: { token?: string; url?: string; code?: number } = {}) {
  const calls: string[][] = [];
  const exec = async (cmd: string[]) => {
    calls.push(cmd);
    const stdout = cmd[1] === "get" ? (over.token ?? `${TOKEN}\n`) : (over.url ?? `${URL_TEXT}\n`);
    return { code: over.code ?? 0, stdout };
  };
  return { calls, exec };
}

describe("remote hosts: what the helper is asked and what it gives (#3429)", () => {
  test("it runs `get -- <id>` and `url -- <id>` and nothing else, and trims the lines", async () => {
    const helper = fakeHelper();
    const credential = await readCredential(helper.exec, "/opt/flightdeck-cred", ID);
    expect(helper.calls).toEqual([
      ["/opt/flightdeck-cred", "get", "--", ID],
      ["/opt/flightdeck-cred", "url", "--", ID],
    ]);
    expect(credential?.url).toBe(URL_TEXT);
    expect(credential?.token()).toBe(TOKEN);
  });

  test("the token shows in neither JSON.stringify nor String of the credential", async () => {
    const credential = await readCredential(fakeHelper().exec, "/h", ID);
    expect(JSON.stringify(credential)).not.toContain(TOKEN);
    expect(
      Object.values(credential ?? {})
        .map(String)
        .join(" "),
    ).not.toContain(TOKEN);
  });

  test("an id that is not a UUID never reaches the helper", async () => {
    const helper = fakeHelper();
    for (const id of ["--version", `${ID}\n`, `${ID}:url`, "", "../x"]) {
      expect({ id, credential: await readCredential(helper.exec, "/h", id) }).toEqual({
        id,
        credential: null,
      });
    }
    expect(helper.calls).toEqual([]);
  });

  test("a helper that fails, prints nothing or prints too much gives no credential", async () => {
    for (const bad of [
      fakeHelper({ code: 1 }),
      fakeHelper({ token: "\n" }),
      fakeHelper({ url: "" }),
      fakeHelper({ token: "x".repeat(5000) }),
      fakeHelper({ token: "tok\nsecond line" }),
      fakeHelper({ token: "tok\u0000en" }),
    ])
      expect(await readCredential(bad.exec, "/h", ID)).toBeNull();
  });

  test("a helper that cannot be started is no credential, not an error", async () => {
    const broken = async () => {
      throw new Error("spawn ENOENT: /h");
    };
    expect(await readCredential(broken, "/h", ID)).toBeNull();
  });
});

/** A shell script as the helper. */
function script(body: string) {
  const dir = tempDir("fd-helper-script-");
  const file = join(dir, "flightdeck-cred");
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

describe.skipIf(process.platform === "win32")(
  "remote hosts: a helper that hangs or floods is a failure (#3429)",
  () => {
    test("what it prints and its exit code come back", async () => {
      expect(await boundedExec(5000)([script("echo abc")])).toEqual({ code: 0, stdout: "abc\n" });
      expect((await boundedExec(5000)([script("exit 3")])).code).toBe(3);
    });

    test("a helper that does not return is stopped at the time limit, with a failing code", async () => {
      const got = await boundedExec(300)([script("exec sleep 30")]);
      expect(got.code).not.toBe(0);
    });

    test("a helper that prints without end is cut, and fails", async () => {
      const got = await boundedExec(5000)([
        script("exec yes aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
      ]);
      expect({ failed: got.code !== 0, small: got.stdout.length <= 16_384 }).toEqual({
        failed: true,
        small: true,
      });
    });
  },
);
