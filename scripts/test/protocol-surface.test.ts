import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { removed, walkSchema } from "../lib/protocol-surface.ts";

const ROOT = resolve(import.meta.dir, "../..");
const BASELINE = join(ROOT, "packages/protocol/surface-baseline.txt");

const COMMAND = {
  oneOf: [
    {
      type: "object",
      properties: {
        type: { type: "string", const: "hello" },
        payload: {
          type: "object",
          properties: { token: { type: "string" }, protocolVersion: { type: "number" } },
          required: ["token"],
        },
      },
      required: ["type", "payload"],
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "card.move" },
        column: { type: "string", enum: ["todo", "doing"] },
        tags: { type: "array", items: { type: "object", properties: { id: { type: "string" } } } },
      },
      required: ["type", "column"],
    },
  ],
};

describe("protocol-surface", () => {
  test("a schema's surface has its commands, fields (optional ones with ?), constants and enum values", () => {
    expect(walkSchema("Command", COMMAND)).toEqual([
      "Command[type=hello].type",
      'Command[type=hello].type=="hello"',
      "Command[type=hello].payload",
      "Command[type=hello].payload.token",
      "Command[type=hello].payload.protocolVersion?",
      "Command[type=card.move].type",
      'Command[type=card.move].type=="card.move"',
      "Command[type=card.move].column",
      'Command[type=card.move].column="todo"',
      'Command[type=card.move].column="doing"',
      "Command[type=card.move].tags?",
      "Command[type=card.move].tags[].id?",
    ]);
  });

  test("a line the baseline has and the code lost is reported; additions are not", () => {
    const baseline = ["A.x", "A.y?", 'A.k="a"', "B[type=old].type"];
    const current = ["A.x", "A.y", 'A.k="a"', 'A.k="b"', "C.z?"];
    expect(removed(baseline, current)).toEqual(["A.y?", "B[type=old].type"]);
  });

  test("the protocol keeps every line of its release baseline", async () => {
    const protocol = await import("../../packages/protocol/src/index.ts");
    const current = Object.entries(protocol)
      .filter(([, value]) => typeof value === "object" && value !== null && "_zod" in value)
      .flatMap(([name, schema]) =>
        walkSchema(
          name,
          (schema as { toJSONSchema(o: object): unknown }).toJSONSchema({
            unrepresentable: "any",
            io: "input",
          }),
        ),
      );
    const baseline = existsSync(BASELINE)
      ? readFileSync(BASELINE, "utf8").split("\n").filter(Boolean)
      : [];
    // Refresh it only at release: bun run scripts/protocol-surface.ts --write
    expect(removed(baseline, current)).toEqual([]);
    expect(current.length).toBeGreaterThan(1000);
  });
});
