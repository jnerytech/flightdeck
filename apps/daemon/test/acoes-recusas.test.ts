import { describe, expect, test } from "bun:test";
import { resolveParams, runAction } from "../src/actions/run.ts";
import type { ActionDef } from "../src/actions/schema.ts";
import { envInput } from "../src/actions/ssh-command.ts";
import type { FlightdeckError } from "../src/errors.ts";

const action = (extra: Partial<ActionDef> = {}): ActionDef =>
  ({
    name: "deploy",
    description: "d",
    run: ["echo", "{{param.env}}"],
    params: { env: { pattern: "prod|dev" } },
    ...extra,
  }) as ActionDef;

const why = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    const e = error as FlightdeckError;
    return { code: e.code, reason: e.reason, params: e.params };
  }
  return null;
};

describe("acoes-recusas: running an action says why with a reason", () => {
  test("a parameter that is unknown, missing or off its pattern", () => {
    expect(why(() => resolveParams(action(), { nope: "x", env: "prod" }))).toEqual({
      code: "bad_request",
      reason: "action_param_unknown",
      params: { param: "nope" },
    });
    expect(why(() => resolveParams(action(), {}))).toEqual({
      code: "bad_request",
      reason: "action_param_missing",
      params: { param: "env" },
    });
    expect(why(() => resolveParams(action(), { env: "qa" }))).toEqual({
      code: "bad_request",
      reason: "action_param_pattern",
      params: { param: "env", pattern: "prod|dev" },
    });
  });

  test("a secret that did not come, an ssh action with no executor, a program that will not start", async () => {
    const secret = await runAction(
      action({ params: {}, env: { TOKEN: "{{secret.tok}}" } } as Partial<ActionDef>),
      {},
      {},
      {},
    ).catch((e: FlightdeckError) => e);
    expect(secret).toMatchObject({ reason: "action_secret_missing", params: { secret: "tok" } });
    const ssh = await runAction(
      action({ params: {}, ssh: "vps" } as Partial<ActionDef>),
      {},
      {},
      {},
    ).catch((e: FlightdeckError) => e);
    expect(ssh).toMatchObject({ reason: "action_ssh_unavailable", params: { action: "deploy" } });
    const spawn = await runAction(
      action({ params: {}, run: ["/nonexistent/bin"] } as Partial<ActionDef>),
      {},
      {},
      {},
    ).catch((e: FlightdeckError) => e);
    expect(spawn).toMatchObject({
      reason: "action_spawn_failed",
      params: { command: "/nonexistent/bin" },
    });
  });

  test("an ssh variable with a bad name or a line break", () => {
    expect(why(() => envInput({ "BAD-NAME": "x" }))).toEqual({
      code: "bad_request",
      reason: "action_ssh_env_name",
      params: { name: "BAD-NAME" },
    });
    expect(why(() => envInput({ KEY: "a\nb" }))).toEqual({
      code: "bad_request",
      reason: "action_ssh_env_value",
      params: { name: "KEY" },
    });
  });
});
