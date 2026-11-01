import { describe, expect, test } from "bun:test";
import { workflowIssueText } from "../src/i18n/errors.ts";
import { translator } from "../src/i18n/index.ts";

describe("recusas-workflows: what is wrong in a workflow file, said in the app's language", () => {
  test("a known code is translated, under the step it belongs to", () => {
    const t = translator("en");
    expect(
      workflowIssueText({ path: "steps.build", code: "unknown_field", params: { field: "x" } }, t),
    ).toBe("steps.build: This field does not exist: x.");
    expect(workflowIssueText({ path: "", code: "required" }, t)).toBe("This field is required.");
  });

  test("a code a newer daemon sent and this app does not know is shown as it came", () => {
    const t = translator("pt-BR");
    expect(workflowIssueText({ path: "steps.a", code: "from_the_future" }, t)).toBe(
      "steps.a: from_the_future",
    );
  });
});
