import { describe, expect, test } from "bun:test";
import { createOpenCodeServer } from "../../src/runtime/opencode-server.ts";
import type { CreatedOpenCode } from "../../src/runtime/opencode-wiring.ts";

/** The module hands the server what the host offers of OpenCode: whether it runs, and its models. */
describe("opencode-server: the module the server takes `opencode` from (#2175)", () => {
  test("it answers the info and the models of the OpenCode it was given", async () => {
    const opencode: CreatedOpenCode = {
      info: { available: false, reason: "opencode_disabled" },
      models: () => Promise.resolve([{ id: "a/b", name: "b" }]),
    };
    const served = createOpenCodeServer(opencode).modules[0].server?.opencode;
    expect([served?.info(), await served?.models()]).toEqual([
      { available: false, reason: "opencode_disabled" },
      [{ id: "a/b", name: "b" }],
    ]);
  });

  test("asking for the models of a host with OpenCode off fails, as it always did", () => {
    const opencode: CreatedOpenCode = { info: { available: false, reason: "opencode_disabled" } };
    const served = createOpenCodeServer(opencode).modules[0].server?.opencode;
    expect(() => served?.models()).toThrow(TypeError);
  });
});
