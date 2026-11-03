import { expect, test } from "bun:test";
import { delimiter } from "node:path";
import { installFakeCli } from "./fake-cli.ts";

test("fakes restored in any order leave the PATH they found", () => {
  const env: Record<string, string | undefined> = { PATH: "/usr/bin" };
  const first = installFakeCli("gh", [], env);
  const second = installFakeCli("claude", [], env);
  first.restore();
  second.restore();
  expect(env.PATH).toBe("/usr/bin");
});

test("restoring one fake keeps the other on PATH", () => {
  const env: Record<string, string | undefined> = { PATH: "/usr/bin" };
  const first = installFakeCli("gh", [], env);
  const second = installFakeCli("claude", [], env);
  first.restore();
  expect(env.PATH).toBe([second.dir, "/usr/bin"].join(delimiter));
  second.restore();
  expect(env.PATH).toBe("/usr/bin");
});

test("a rule can write to stderr, as gh does for a login's one-time code", async () => {
  const env: Record<string, string | undefined> = { ...process.env };
  const fake = installFakeCli(
    "gh",
    [
      {
        args: ["auth", "login"],
        stdout: "out\n",
        stderr: "! First copy your one-time code: ABCD-1234\n",
      },
    ],
    env,
  );
  try {
    const proc = Bun.spawn(["gh", "auth", "login"], {
      env: env as Record<string, string>,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(out).toBe("out\n");
    expect(err).toBe("! First copy your one-time code: ABCD-1234\n");
  } finally {
    fake.restore();
  }
});
