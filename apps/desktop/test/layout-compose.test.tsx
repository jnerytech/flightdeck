import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { Inline, Stack } = await import("../src/components/layout/stack.tsx");
const { Panel } = await import("../src/components/layout/panel.tsx");
const { ListRow } = await import("../src/components/layout/list-row.tsx");
const { TwoPane } = await import("../src/components/layout/two-pane.tsx");

afterEach(cleanup);

describe("layout-compose: what the screens need to compose lists and columns", () => {
  test("a Stack or an Inline can be a named list, so its children are list items", () => {
    const stack = render(
      <Stack as="ul" label="Plugins" gap={2}>
        <li>a</li>
      </Stack>,
    );
    const list = screen.queryByRole("list", { name: "Plugins" });
    expect(list?.tagName).toBe("UL");
    expect(list?.className).toContain("flex-col");
    expect(list?.className).toContain("gap-2");
    stack.unmount();
    render(
      <Inline as="ul" label="Tags">
        <li>a</li>
      </Inline>,
    );
    expect(screen.queryByRole("list", { name: "Tags" })?.className).toContain("flex-wrap");
  });

  test("without `as` they stay plain divs with no name", () => {
    const { container } = render(
      <Stack>
        <span>a</span>
      </Stack>,
    );
    expect(container.firstElementChild?.tagName).toBe("DIV");
    expect(container.firstElementChild?.hasAttribute("aria-label")).toBe(false);
  });

  test("a Panel can be an item of a list, with the tighter padding of an item", () => {
    const { container } = render(
      <ul>
        <Panel as="li" size="sm">
          item
        </Panel>
      </ul>,
    );
    const item = container.querySelector("li");
    expect(item?.className).toContain("p-3");
    expect(item?.className).not.toContain("p-4");
    cleanup();
    const block = render(<Panel>block</Panel>);
    expect(block.container.firstElementChild?.tagName).toBe("SECTION");
    expect(block.container.firstElementChild?.className).toContain("p-4");
  });

  test("a boxed ListRow has a border and padding, and the selected one is highlighted", () => {
    const { container } = render(<ListRow title="a" boxed selected />);
    const row = container.firstElementChild;
    expect(row?.className).toContain("border");
    expect(row?.className).toContain("px-3");
    expect(row?.className).toContain("bg-accent");
    cleanup();
    const plain = render(<ListRow title="a" />);
    expect(plain.container.firstElementChild?.className).not.toContain("border");
    expect(plain.container.firstElementChild?.className).not.toContain("bg-accent");
  });

  test("TwoPane: one column when narrow, and a fixed side column beside a flexible one when wide", () => {
    const { container } = render(
      <TwoPane side={<p>side</p>}>
        <p>main</p>
      </TwoPane>,
    );
    const root = container.firstElementChild;
    expect(root?.className).toContain("grid");
    expect(root?.className).toContain("grid-cols-[18rem_minmax(0,1fr)]");
    expect(root?.firstElementChild?.textContent).toBe("side");
    expect(root?.lastElementChild?.textContent).toBe("main");
  });
});
