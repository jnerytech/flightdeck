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
    expect(() => definitionOf("{not json")).toThrow("text is not JSON");
    expect(() => definitionOf(JSON.stringify({ name: "x", run: "rm -rf /" }))).toThrow(
      "JSON does not fit",
    );
  });

  test("a key the row holds beyond the declared ones is kept", () => {
    const stored = {
      ...{ name: "a", description: "", run: ["x"], env: {}, params: {}, timeoutS: 1 },
      later: 1,
    };
    expect(definitionOf(JSON.stringify(stored))).toEqual(stored as ActionDef);
  });

  test("the pinned files come back as a path to hash record, and bad text is refused", () => {
    expect(pinnedFilesOf('{"scripts/deploy.sh":"abc"}')).toEqual({ "scripts/deploy.sh": "abc" });
    expect(() => pinnedFilesOf('["scripts/deploy.sh"]')).toThrow("JSON does not fit");
  });
});
