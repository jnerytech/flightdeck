import { describe, expect, test } from "bun:test";
import { definitionOf, pinnedFilesOf } from "../../src/actions/row-json.ts";
import type { ActionDef } from "../../src/actions/schema.ts";

/** Issue #1609: the JSON columns of an action row are read through their schemas. */
describe("action row JSON: the columns are parsed, not cast (#1609)", () => {
  test("a stored definition comes back as the action it declares", () => {
    const stored: ActionDef = {
      name: "deploy",
      description: "ship it",
      run: ["./deploy.sh", "{{param.env}}"],
      env: { TOKEN: "{{secret.deploy}}" },
      params: { env: { pattern: "^(prod|dev)$", default: "dev" } },
      timeoutS: 60,
      approval: "always",
      tags: ["prod"],
    };
    expect(definitionOf(JSON.stringify(stored))).toEqual(stored);
  });

  test("a definition that does not fit is refused, never half read", () => {
    const refusal = (text: string) => {
      try {
        definitionOf(text);
        return "read";
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect([refusal("{not json"), refusal(JSON.stringify({ name: "x", run: "rm -rf /" }))]).toEqual(
      ["text is not JSON", "JSON does not fit (5 problem(s): invalid_type)"],
    );
  });

  test("the pinned files come back as a path to hash record, and bad text is refused", () => {
    expect(pinnedFilesOf('{"scripts/deploy.sh":"abc"}')).toEqual({ "scripts/deploy.sh": "abc" });
    expect(() => pinnedFilesOf('["scripts/deploy.sh"]')).toThrow("JSON does not fit");
  });
});
