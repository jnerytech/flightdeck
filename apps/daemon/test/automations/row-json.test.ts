import { describe, expect, test } from "bun:test";
import { actionOf, triggerOf } from "../../src/automations/row-json.ts";

/** Issue #1609: the trigger and action columns of an automation are read through the protocol's schemas. */
describe("automation row JSON: the columns are parsed, not cast (#1609)", () => {
  test("a stored trigger and action come back as what they declare", () => {
    expect([
      triggerOf('{"type":"cron","expr":"0 9 * * *","tz":"UTC"}'),
      actionOf('{"type":"start_workflow","workflow":"fix","inputs":{"a":"b"}}'),
    ]).toEqual([
      { type: "cron", expr: "0 9 * * *", tz: "UTC" },
      { type: "start_workflow", workflow: "fix", inputs: { a: "b" } },
    ]);
  });

  test("a column that is not JSON, or of an unknown type, is refused", () => {
    expect(() => triggerOf("{not json")).toThrow("text is not JSON");
    expect(() => triggerOf('{"type":"webhook"}')).toThrow("JSON does not fit");
    expect(() => actionOf('{"type":"start_workflow"}')).toThrow("JSON does not fit");
  });
});
