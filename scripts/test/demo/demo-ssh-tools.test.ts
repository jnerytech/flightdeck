import { describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { DEMO_SSH_PASSWORD, demoSshHost, installDemoSsh } from "../../lib/demo/fake-ssh.ts";
import { realTempDir } from "../temp-dir.ts";

/**
 * #3989: the demo's SSH journey connects to a destination that asks for a password. The demo's daemons run in
 * this process, so the fake `ssh` and `ssh-keyscan` go on the PATH the daemons read, and what they need to
 * answer (the server keys, the hash of the password) is written into their wrappers, never into the
 * environment of the demo. Nothing here starts a real ssh or reads a real key.
 */
// A wrapper is a `sh` script off Windows and a `.cmd` on it; these runs read the first.
const posix = process.platform !== "win32";

/** One run of a tool of the fake folder with only what the caller gives it in its environment. */
async function run(tool: string, args: string[], env: Record<string, string> = {}) {
  try {
    const child = Bun.spawn([tool, ...args], {
      env: { PATH: process.env.PATH ?? "", ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return { code, out };
  } catch {
    return { code: -1, out: "" };
  }
}

/** An askpass program that answers `password`, as the daemon's helper answers what the person typed. */
function askpassSaying(dir: string, password: string): string {
  const path = join(dir, "askpass.sh");
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' '${password}'\n`);
  chmodSync(path, 0o755);
  return path;
}

function fake(env: Record<string, string | undefined> = { PATH: "/usr/bin" }) {
  const work = realTempDir("fd-demo-ssh-");
  return { work, env, ssh: installDemoSsh(work, env, 0) };
}

describe("demo-ssh-tools: the fake ssh the demo's SSH journey connects with", () => {
  test.skipIf(!posix)("ssh-keyscan answers with the key of the journey's server", async () => {
    const { ssh } = fake();
    const host = demoSshHost("en");
    const got = await run(join(dirname(ssh.ssh), "ssh-keyscan"), ["-p", "22", "--", host]);
    expect({ code: got.code, names: got.out.includes(`${host} ssh-ed25519 `) }).toEqual({
      code: 0,
      names: true,
    });
  });

  test.skipIf(!posix)("ssh-keyscan has no key for a server the journey does not use", async () => {
    const { ssh } = fake();
    const got = await run(join(dirname(ssh.ssh), "ssh-keyscan"), ["--", "elsewhere.example.test"]);
    expect(got.code).toBe(1);
  });

  test.skipIf(!posix)("the two languages' servers have keys of their own", () => {
    expect(demoSshHost("en")).not.toBe(demoSshHost("pt-br"));
  });

  test.skipIf(!posix)(
    "ssh runs the askpass it is given and accepts the journey's password, with nothing in its environment",
    async () => {
      const { ssh, work } = fake();
      const got = await run(
        ssh.ssh,
        ["-o", "PubkeyAuthentication=no", `ops@${demoSshHost("en")}`],
        { SSH_ASKPASS: askpassSaying(work, DEMO_SSH_PASSWORD) },
      );
      expect(got.out).toContain("PASSWORD-OK FAKE-SSH-CONNECTED");
    },
  );

  test.skipIf(!posix)("ssh refuses any other password", async () => {
    const { ssh, work } = fake();
    const got = await run(ssh.ssh, ["-o", "PubkeyAuthentication=no", `ops@${demoSshHost("en")}`], {
      SSH_ASKPASS: askpassSaying(work, "not-the-password"),
    });
    expect(got.out).toContain("PASSWORD-BAD");
  });

  test("the fake folder goes first on the PATH it is given and leaves it again on restore", () => {
    const env: Record<string, string | undefined> = { PATH: "/usr/bin" };
    const { ssh } = fake(env);
    const during = (env.PATH ?? "").split(delimiter);
    ssh.restore();
    expect({
      first: during[0],
      rest: during.slice(1),
      after: env.PATH,
    }).toEqual({
      first: dirname(ssh.ssh),
      rest: ["/usr/bin"],
      after: "/usr/bin",
    });
  });

  test("what the fake answers with is not put in the environment it was given", () => {
    const env: Record<string, string | undefined> = { PATH: "/usr/bin" };
    fake(env);
    expect(Object.keys(env).filter((name) => name.startsWith("FD_FAKE"))).toEqual([]);
  });
});
