import { afterEach, describe, expect, test } from "bun:test";
import { PENDING_SELECTOR } from "../../../scripts/lib/shots-loaded.ts";
import { registerDom } from "./dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { cleanup, render } = await import("@testing-library/react");
const { EmptyState, LoadingState } = await import("../src/components/layout/states.tsx");

afterEach(cleanup);

describe("shots-carregados", () => {
  test("PENDING_SELECTOR matches every loading shape and nothing that is loaded", () => {
    for (const shape of ["rows", "columns", "tiles"] as const) {
      const { container, unmount } = render(<LoadingState label="x" shape={shape} />);
      expect(container.querySelector(PENDING_SELECTOR)).not.toBeNull();
      unmount();
    }
    const loaded = render(<EmptyState title="Nenhum card" />);
    expect(loaded.container.querySelector(PENDING_SELECTOR)).toBeNull();
  });
});
