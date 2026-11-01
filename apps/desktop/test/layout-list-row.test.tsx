import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";

registerDom();
const { cleanup, render } = await import("@testing-library/react");
const { ListRow } = await import("../src/components/layout/list-row.tsx");

afterEach(cleanup);

const part = (container: HTMLElement, name: string) =>
  container.querySelector(`[data-row-${name}]`) as HTMLElement | null;

describe("layout-list-row: the title wins the width", () => {
  test("the title takes the free width and truncates; the meta shrinks far faster", () => {
    const { container } = render(
      <ListRow
        title="Fix the import"
        meta="alfa · terminal"
        trailing={<button type="button">×</button>}
      />,
    );
    const title = part(container, "title");
    const meta = part(container, "meta");
    expect(title?.className ?? "").toContain("flex-auto");
    expect(title?.className ?? "").toContain("min-w-0");
    expect(title?.className ?? "").toContain("truncate");
    expect(meta?.className ?? "").toContain("shrink-[8]");
    expect(meta?.className ?? "").toContain("truncate");
    expect(meta?.textContent).toBe("alfa · terminal");
  });

  test("leading and trailing never shrink, and sit around the title in that order", () => {
    const { container } = render(
      <ListRow
        leading={<span>●</span>}
        title="Fix"
        meta="alfa"
        trailing={<button type="button">×</button>}
      />,
    );
    const order = [...(container.firstElementChild?.children ?? [])].map((el) =>
      el.hasAttribute("data-row-leading")
        ? "leading"
        : el.hasAttribute("data-row-title")
          ? "title"
          : el.hasAttribute("data-row-meta")
            ? "meta"
            : el.hasAttribute("data-row-trailing")
              ? "trailing"
              : "other",
    );
    expect(order).toEqual(["leading", "title", "meta", "trailing"]);
    expect(part(container, "leading")?.className ?? "").toContain("shrink-0");
    expect(part(container, "trailing")?.className ?? "").toContain("shrink-0");
  });

  test("an empty meta renders nothing, so no gap is left behind", () => {
    const { container } = render(<ListRow title="Fix" meta={null} />);
    expect(part(container, "meta")).toBeNull();
    expect(part(container, "title")).not.toBeNull();
  });

  test("the row is one line that never overflows its box", () => {
    const { container } = render(<ListRow title="Fix" className="extra" />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain("flex");
    expect(row.className).toContain("items-center");
    expect(row.className).toContain("min-w-0");
    expect(row.className).toContain("extra");
  });
});
