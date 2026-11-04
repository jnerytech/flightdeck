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

test("a rule can hold the process after it wrote, until it is killed or the delay passes", async () => {
  const env: Record<string, string | undefined> = { ...process.env };
  const fake = installFakeCli(
    "gh",
    [{ args: ["auth", "login"], stderr: "code\n", delayMs: 400 }],
    env,
  );
  try {
    const started = Date.now();
    const proc = Bun.spawn(["gh", "auth", "login"], {
      env: env as Record<string, string>,
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
    expect(Date.now() - started).toBeGreaterThanOrEqual(350);
  } finally {
    fake.restore();
  }
});

test("a rule can match by text inside the arguments, which is how a GraphQL call is told apart", async () => {
  const env: Record<string, string | undefined> = { ...process.env };
  const fake = installFakeCli(
    "gh",
    [
      { args: ["api", "graphql"], contains: ["items(first"], stdout: "items\n" },
      { args: ["api", "graphql"], contains: ["fields(first"], stdout: "fields\n" },
    ],
    env,
  );
  try {
    const ask = async (query: string) => {
      const proc = Bun.spawn(["gh", "api", "graphql", "-f", `query=${query}`], {
        env: env as Record<string, string>,
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = await new Response(proc.stdout).text();
      await proc.exited;
      return out;
    };
    expect(await ask("query { node { items(first: 100) } }")).toBe("items\n");
    expect(await ask("query { node { fields(first: 20) } }")).toBe("fields\n");
  } finally {
    fake.restore();
  }
});

test("every fake refuses what Bun refuses for a Windows .cmd shim, unless told not to", async () => {
  const env: Record<string, string | undefined> = { ...process.env };
  const fake = installFakeCli("gh", [{ args: [], stdout: "ok\n" }], env);
  const lenient = installFakeCli("gh", [{ args: [], stdout: "ok\n" }], env, {
    rejectCmdChars: false,
  });
  try {
    const run = async (arg: string) => {
      const proc = Bun.spawn(["bash", "-c", `"${fake.dir}/gh" "$1"`, "x", arg], {
        env: env as Record<string, string>,
        stdout: "pipe",
        stderr: "pipe",
      });
      return { code: await proc.exited, out: await new Response(proc.stdout).text() };
    };
    expect((await run('query { field(name: "Status") }')).code).toBe(1);
    expect((await run("plain")).out).toBe("ok\n");
    const loose = Bun.spawn(["bash", "-c", `"${lenient.dir}/gh" 'a "quoted" word'`], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await loose.exited).toBe(0);
  } finally {
    fake.restore();
    lenient.restore();
  }
});
