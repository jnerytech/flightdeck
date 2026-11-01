import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { Facts } = await import("../src/components/layout/facts.tsx");

afterEach(cleanup);

describe("layout-facts: a key/value list", () => {
  test("each fact is a term and its description, in order, in one description list", () => {
    const { container } = render(
      <Facts
        items={[
          { label: "Banco", value: "692.0 KB" },
          { label: "Último backup", value: "nenhum ainda" },
        ]}
      />,
    );
    const list = container.querySelector("dl");
    expect(list).not.toBeNull();
    expect([...(list?.querySelectorAll("dt") ?? [])].map((el) => el.textContent)).toEqual([
      "Banco",
      "Último backup",
    ]);
    expect([...(list?.querySelectorAll("dd") ?? [])].map((el) => el.textContent)).toEqual([
      "692.0 KB",
      "nenhum ainda",
    ]);
    expect(screen.queryByText("Banco")?.tagName).toBe("DT");
  });

  test("the labels and the values are two columns of one grid, so the values line up", () => {
    const { container } = render(<Facts items={[{ label: "a", value: "b" }]} />);
    const className = container.querySelector("dl")?.className ?? "";
    expect(className).toContain("grid");
    expect(className).toContain("grid-cols-[auto_1fr]");
    expect(container.querySelector("dt")?.className ?? "").toContain("text-muted-foreground");
  });

  test("a long value wraps inside its column instead of pushing the labels", () => {
    const { container } = render(<Facts items={[{ label: "a", value: "b" }]} />);
    expect(container.querySelector("dd")?.className ?? "").toContain("min-w-0");
  });
});
