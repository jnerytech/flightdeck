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
