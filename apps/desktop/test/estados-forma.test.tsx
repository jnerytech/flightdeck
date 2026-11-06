import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { cleanup, render } = await import("@testing-library/react");
const { LoadingState } = await import("../src/components/layout/states.tsx");

afterEach(cleanup);

const SHAPES = [
  ["rows", 3],
  ["columns", 5],
  ["tiles", 4],
] as const;

describe("estados-forma", () => {
  test("the default shape is text rows", () => {
    const { container } = render(<LoadingState label="Carregando" />);
    expect(container.querySelector("[data-shape]")?.getAttribute("data-shape")).toBe("rows");
  });

  for (const [shape, blocks] of SHAPES) {
    test(`${shape}: a busy status with its label and ${blocks} blocks`, () => {
      const { container, getByRole } = render(<LoadingState label="Carregando" shape={shape} />);
      const status = getByRole("status", { name: "Carregando" });
      expect(status.getAttribute("aria-busy")).toBe("true");
      expect(status.getAttribute("data-shape")).toBe(shape);
      expect(container.querySelectorAll("[data-slot=skeleton]")).toHaveLength(blocks);
    });
  }
});
