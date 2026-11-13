import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "../dom.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { StatusDot } = await import("../../src/shared/status/index.ts");

setDefaultTimeout(20_000);
afterEach(cleanup);

const TONES = ["running", "needs-you", "idle", "ended", "error"] as const;

function dots() {
  render(
    <div>
      {TONES.map((tone) => (
        <StatusDot key={tone} tone={tone} label={`estado ${tone}`} />
      ))}
    </div>,
  );
  return (tone: string) => screen.getByRole("img", { name: `estado ${tone}` });
}

/** The shape a state is drawn with, whatever its colour: a data-glyph or the lucide icon's class. */
const shape = (el: HTMLElement) =>
  el.querySelector("[data-glyph]")?.getAttribute("data-glyph") ??
  [...(el.querySelector("svg")?.classList ?? [])].find((c) => c.startsWith("lucide-")) ??
  null;

describe("estado-glifos: a state has a shape as well as a colour (issue #146)", () => {
  test("running, needs-you, error, idle and ended are five different shapes", () => {
    const dot = dots();
    const shapes = TONES.map((tone) => shape(dot(tone)));
    expect(shapes).toEqual([
      "spinner",
      "lucide-message-circle-question-mark",
      "dot",
      "ring",
      "lucide-circle-alert",
    ]);
    expect(new Set(shapes).size).toBe(5);
  });

  test("each glyph is named for screen readers", () => {
    const dot = dots();
    for (const tone of TONES) {
      expect(dot(tone).getAttribute("aria-label")).toBe(`estado ${tone}`);
    }
  });

  test("extra attributes reach the slot, so a caller can mark its glyph", () => {
    render(<StatusDot tone="needs-you" label="precisa" data-badge="needs-you" />);
    expect(screen.getByRole("img", { name: "precisa" }).getAttribute("data-badge")).toBe(
      "needs-you",
    );
  });
});

describe("estado-glifos: a real tooltip names the state (issue #146)", () => {
  test("no native title; hovering shows the label in a tooltip, with no provider around it", async () => {
    const dot = dots();
    expect(dot("running").getAttribute("title")).toBeNull();
    await act(async () => {
      fireEvent.pointerMove(dot("running"), { pointerType: "mouse" });
    });
    await settle(() => screen.queryByRole("tooltip") !== null, 3000, "the tooltip opens");
    expect(screen.getByRole("tooltip").textContent).toBe("estado running");
  });
});

describe("estado-glifos: an off-screen spinner stops turning (issue #146)", () => {
  type Callback = (entries: Array<{ isIntersecting: boolean }>) => void;
  const original = globalThis.IntersectionObserver;
  afterEach(() => {
    globalThis.IntersectionObserver = original;
  });

  function fake() {
    const seen: { callback: Callback | null; disconnected: boolean; observed: unknown[] } = {
      callback: null,
      disconnected: false,
      observed: [],
    };
    globalThis.IntersectionObserver = class {
      constructor(callback: Callback) {
        seen.callback = callback;
      }
      observe(el: unknown) {
        seen.observed.push(el);
      }
      disconnect() {
        seen.disconnected = true;
      }
    } as never;
    return seen;
  }

  test("it turns while visible, stops when it leaves the screen and turns again on return", async () => {
    const seen = fake();
    render(<StatusDot tone="running" label="rodando" />);
    const dot = screen.getByRole("img", { name: "rodando" });
    expect(seen.observed).toHaveLength(1);
    expect(dot.innerHTML).toContain("motion-safe:animate-spin");
    await act(async () => seen.callback?.([{ isIntersecting: false }]));
    expect(dot.innerHTML).not.toContain("animate-spin");
    await act(async () => seen.callback?.([{ isIntersecting: true }]));
    expect(dot.innerHTML).toContain("motion-safe:animate-spin");
  });

  test("the other states do not observe anything, and unmounting lets go", () => {
    const seen = fake();
    render(<StatusDot tone="idle" label="ocioso" />);
    expect(seen.observed).toHaveLength(0);
    cleanup();
    render(<StatusDot tone="running" label="rodando" />);
    cleanup();
    expect(seen.disconnected).toBe(true);
  });

  test("without IntersectionObserver the spinner simply turns", () => {
    // biome-ignore lint/suspicious/noExplicitAny: removing a browser API for the test
    (globalThis as any).IntersectionObserver = undefined;
    render(<StatusDot tone="running" label="rodando" />);
    expect(screen.getByRole("img", { name: "rodando" }).innerHTML).toContain(
      "motion-safe:animate-spin",
    );
  });
});

describe("estado-glifos: a host's connection stays a plain dot (issue #146)", () => {
  test("`dot` draws no glyph and leaks neither `hollow` nor `pulse` into the DOM", () => {
    render(
      <div>
        <StatusDot dot tone="running" label="online" />
        <StatusDot dot hollow tone="idle" label="offline" />
        <StatusDot dot pulse tone="needs-you" label="conectando" />
      </div>,
    );
    const online = screen.getByRole("img", { name: "online" });
    expect(online.querySelector("svg, [data-glyph]")).toBeNull();
    const offline = screen.getByRole("img", { name: "offline" });
    const connecting = screen.getByRole("img", { name: "conectando" });
    for (const el of [online, offline, connecting]) {
      expect(el.hasAttribute("hollow")).toBe(false);
      expect(el.hasAttribute("pulse")).toBe(false);
    }
  });
});
