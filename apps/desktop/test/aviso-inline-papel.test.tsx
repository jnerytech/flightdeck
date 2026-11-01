import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";

registerDom();
const { cleanup, render } = await import("@testing-library/react");
const { InlineNotice } = await import("../src/components/feedback/inline-notice.tsx");

afterEach(cleanup);

describe("aviso-inline: the notice is announced by its tone", () => {
  test("an error is an alert", () => {
    const view = render(<InlineNotice tone="error">it failed</InlineNotice>);
    expect(view.getByRole("alert").textContent).toBe("it failed");
  });

  for (const tone of ["info", "warn", undefined] as const) {
    test(`a ${tone ?? "default"} notice is a polite status, not an alert`, () => {
      const view = render(<InlineNotice tone={tone}>heads up</InlineNotice>);
      expect(view.getByRole("status").textContent).toBe("heads up");
      expect(view.queryByRole("alert")).toBeNull();
    });
  }

  test("it keeps its id, so a control can point at it", () => {
    const view = render(
      <InlineNotice id="n1" tone="error">
        it failed
      </InlineNotice>,
    );
    expect(view.getByRole("alert").id).toBe("n1");
  });
});
