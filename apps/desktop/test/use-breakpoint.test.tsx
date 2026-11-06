import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, render } = await import("@testing-library/react");
const { useBreakpoint } = await import("../src/hooks/use-breakpoint.ts");

const settle = waiter(4000);

async function viewport(width: number) {
  await act(async () => {
    (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
      width,
      height: 800,
    });
  });
  await settle(() => window.matchMedia("(width < 640px)").matches === width < 640);
  await act(async () => {});
}

function Probe() {
  return <p data-testid="bp">{useBreakpoint()}</p>;
}
const answer = () => document.querySelector("[data-testid='bp']")?.textContent;

afterEach(async () => {
  cleanup();
  await viewport(1024);
});

describe("use-breakpoint: the window's width as compact, medium or wide (issue #641)", () => {
  test("compact below 640 px, medium from 640 to 1023 px, wide from 1024 px", async () => {
    render(<Probe />);
    expect(answer()).toBe("wide");
    await viewport(1023);
    expect(answer()).toBe("medium");
    await viewport(640);
    expect(answer()).toBe("medium");
    await viewport(639);
    expect(answer()).toBe("compact");
    await viewport(360);
    expect(answer()).toBe("compact");
    await viewport(1024);
    expect(answer()).toBe("wide");
  });
});
