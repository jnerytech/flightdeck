import { afterEach, beforeEach } from "bun:test";
import { registerDom } from "../../../apps/desktop/test/dom.ts";
import { layoutFindings, SPACING, SPACING_RULES } from "../../lib/styles/layout-guards.ts";

registerDom();

/**
 * happy-dom has no layout: a test says where each box is with `data-rect="left,top,right,bottom"`
 * and how much it scrolls with `data-sw` (scrollWidth) and `data-cw` (clientWidth).
 */
const proto = window.Element.prototype as unknown as Record<string, unknown>;
const htmlProto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
const saved = new Map<string, PropertyDescriptor | undefined>();
const NAMES = ["getBoundingClientRect", "scrollWidth", "clientWidth"];

/** Registers the box stubs before each test and puts the prototypes back after it. Call it once at the top of a test file. */
export function installLayoutStubs() {
  beforeEach(() => {
    for (const name of NAMES) saved.set(name, Object.getOwnPropertyDescriptor(proto, name));
    const num = (el: Element, attr: string, fallback: number) =>
      Number(el.getAttribute(attr) ?? fallback);
    Object.defineProperty(proto, "getBoundingClientRect", {
      configurable: true,
      value(this: Element) {
        const [left = 0, top = 0, right = 0, bottom = 0] = (this.getAttribute("data-rect") ?? "")
          .split(",")
          .map(Number);
        return {
          left,
          top,
          right,
          bottom,
          width: right - left,
          height: bottom - top,
          x: left,
          y: top,
        };
      },
    });
    Object.defineProperty(proto, "scrollWidth", {
      configurable: true,
      get(this: Element) {
        return num(this, "data-sw", num(this, "data-cw", 0));
      },
    });
    Object.defineProperty(proto, "clientWidth", {
      configurable: true,
      get(this: Element) {
        return num(this, "data-cw", 0);
      },
    });
    // happy-dom defines these on HTMLElement, which sits above Element: both are shadowed.
    for (const [name, attr] of [
      ["scrollTop", "data-st"],
      ["clientHeight", "data-ch"],
      ["scrollHeight", "data-sh"],
    ] as const) {
      for (const holder of [proto, htmlProto]) {
        saved.set(
          `${holder === proto ? "E" : "H"}:${name}`,
          Object.getOwnPropertyDescriptor(holder, name),
        );
        Object.defineProperty(holder, name, {
          configurable: true,
          get(this: Element) {
            return num(this, attr, 0);
          },
        });
      }
    }
    // The widths too (#588): the text-spill rule reads both on a block, where happy-dom answers 0.
    for (const [name, read] of [
      ["clientWidth", (el: Element) => num(el, "data-cw", 0)],
      ["scrollWidth", (el: Element) => num(el, "data-sw", num(el, "data-cw", 0))],
    ] as const) {
      saved.set(`H:${name}`, Object.getOwnPropertyDescriptor(htmlProto, name));
      Object.defineProperty(htmlProto, name, {
        configurable: true,
        get(this: Element) {
          return read(this);
        },
      });
    }
    window.innerWidth = 1000;
    window.innerHeight = 700;
  });

  afterEach(() => {
    for (const [key, descriptor] of saved) {
      const holder = key.startsWith("H:") ? htmlProto : proto;
      const name = key.replace(/^[EH]:/, "");
      if (descriptor) Object.defineProperty(holder, name, descriptor);
      else delete holder[name];
    }
    saved.clear();
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-sw");
    document.documentElement.removeAttribute("data-cw");
  });
}

export const page = (html: string) => {
  document.body.innerHTML = html;
};
export const rules = () => layoutFindings().map((f) => `${f.rule}: ${f.path}`);

export const spacing = () =>
  layoutFindings({ spacing: SPACING })
    .filter((f) => SPACING_RULES.includes(f.rule))
    .map((f) => `${f.rule}: ${f.path} (${f.detail})`);
