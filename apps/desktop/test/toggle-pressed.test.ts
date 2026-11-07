import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { colorOf, contrast, tokensOf } from "../../../scripts/lib/theme-contrast.ts";

const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");
/** The rule every pressed toggle button gets, whatever its variant; "" when there is none. */
const rule = css.split('[data-slot="button"][aria-pressed="true"] {')[1]?.split(/\n}\n/)[0] ?? "";

describe("toggle-pressed: a pressed toggle button looks pressed (#812)", () => {
  test("a fill from the tokens and a 2 px inset ring, so the state is not color alone", () => {
    expect({
      fill: /background: var\(--accent\);/.test(rule),
      text: /color: var\(--accent-foreground\);/.test(rule),
      ring: /box-shadow: inset 0 0 0 2px var\(--ring\);/.test(rule),
    }).toEqual({ fill: true, text: true, ring: true });
  });

  test("the ring holds 3:1 on the page and on cards, and the label 4.5:1 on the fill, in both themes", () => {
    const root = tokensOf(css, ":root");
    const themes = { light: root, dark: new Map([...root, ...tokensOf(css, ".dark")]) };
    const ratios = Object.fromEntries(
      Object.entries(themes).map(([name, vars]) => {
        const rgb = (token: string) => colorOf(`var(${token})`, vars);
        const pair = (a: string, b: string) => {
          const x = rgb(a);
          const y = rgb(b);
          return x && y ? contrast(x, y) : 0;
        };
        return [
          name,
          {
            ringOnPage: pair("--ring", "--background") >= 3,
            ringOnCard: pair("--ring", "--card") >= 3,
            label: pair("--accent-foreground", "--accent") >= 4.5,
          },
        ];
      }),
    );
    const ok = { ringOnPage: true, ringOnCard: true, label: true };
    const shown: Record<string, unknown> = { rule: rule !== "", ...ratios };
    expect(shown).toEqual({ rule: true, light: ok, dark: ok });
  });
});
