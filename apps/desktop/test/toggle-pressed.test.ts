import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { colorOf, contrast, tokensOf } from "../../../scripts/lib/theme-contrast.ts";

const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");
/** The selector list of the rule: the toggle variants (outline, ghost) when pressed. */
const SELECTOR =
  '[data-slot="button"][data-variant="outline"][aria-pressed="true"],\n[data-slot="button"][data-variant="ghost"][aria-pressed="true"] {';
const at = css.indexOf(SELECTOR);
/** The rule's declarations; "" when there is none. */
const rule = at < 0 ? "" : (css.slice(at + SELECTOR.length).split(/\n}\n/)[0] ?? "");
/** How many blocks are open where the rule starts: 0 is outside every @layer and @media. */
const depth = (() => {
  const before = css.slice(0, Math.max(at, 0)).replace(/\/\*[\s\S]*?\*\//g, "");
  return [...before].reduce((open, c) => open + (c === "{" ? 1 : c === "}" ? -1 : 0), 0);
})();

// Pinned on the stylesheet's text on purpose: the declarations are the contract (#812 review).
describe("toggle-pressed: a pressed toggle button looks pressed (#812)", () => {
  test("a fill from the tokens and a 2 px ring drawn as an outline, so the state is not color alone", () => {
    expect({
      fill: /background: var\(--accent\);/.test(rule),
      text: /color: var\(--accent-foreground\);/.test(rule),
      ring: /outline: 2px solid var\(--ring\);/.test(rule) && /outline-offset: -2px;/.test(rule),
    }).toEqual({ fill: true, text: true, ring: true });
  });

  // OpenCode review of #816: a box-shadow ring beat the layered focus-visible ring, also a shadow.
  test("the focus ring still shows on a pressed button: the rule leaves the shadow alone", () => {
    expect({ found: rule !== "", shadow: /box-shadow/.test(rule) }).toEqual({
      found: true,
      shadow: false,
    });
  });

  // Re-review of #816: the terminal's find toggles are ghost buttons with a pressed ring of their
  // own; with this rule too they drew two rings.
  test("the terminal's find toggles take this ring, not one of their own", () => {
    const own = css.split("@utility terminal-find-toggle {")[1]?.split(/\n}\n/)[0] ?? "";
    expect({ found: own !== "", ownPressed: /aria-pressed/.test(own) }).toEqual({
      found: true,
      ownPressed: false,
    });
  });

  test("outside every layer, so it beats the variant's own background and hover", () => {
    expect({ found: at >= 0, depth }).toEqual({ found: true, depth: 0 });
  });

  test("the ring holds 3:1 on the page, on cards and on its own fill, and the label 4.5:1, in both themes", () => {
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
            ringOnFill: pair("--ring", "--accent") >= 3,
            label: pair("--accent-foreground", "--accent") >= 4.5,
          },
        ];
      }),
    );
    const ok = { ringOnPage: true, ringOnCard: true, ringOnFill: true, label: true };
    const shown: Record<string, unknown> = { rule: rule !== "", ...ratios };
    expect(shown).toEqual({ rule: true, light: ok, dark: ok });
  });
});
