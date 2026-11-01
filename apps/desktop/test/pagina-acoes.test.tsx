import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";

registerDom();
const { cleanup, render } = await import("@testing-library/react");
const { Page } = await import("../src/components/layout/page.tsx");

afterEach(cleanup);

describe("pagina-acoes: the actions of a screen share one baseline", () => {
  test("buttons and fields with a label above them line up at the bottom, wherever the screen puts them", () => {
    const { container } = render(
      <Page title="Tela" actions={<button type="button">Ação</button>}>
        corpo
      </Page>,
    );
    const actions = container.querySelector("[data-slot='page-actions']");
    expect(actions?.textContent).toBe("Ação");
    expect(actions?.className ?? "").toContain("items-end");
  });
});
